#!/usr/bin/env node
// 按需同步 openai/codex 的提示词文件到 reference/codex/。
//
// 用法：
//   node scripts/sync-upstream.mjs             只检查，有差异退出码 1
//   node scripts/sync-upstream.mjs --write     写入本地归档与 reference/upstream.json
//   node scripts/sync-upstream.mjs --write --prune
//                                              同时删除上游已移除、且上次同步过的文件
//   node scripts/sync-upstream.mjs --ref main  指定上游分支 / 标签 / 提交
//
// 零依赖：只用 Node 内置模块和系统 git。首次运行会在 .cache/codex-upstream
// 做一次 blobless 部分克隆，后续复用缓存。

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, '.cache', 'codex-upstream')
const referenceDir = join(root, 'reference')
const manifestPath = join(referenceDir, 'upstream.json')
const repoUrl = 'https://github.com/openai/codex.git'
const defaultRef = 'main'

// 每项把上游路径映射到本地归档路径。只收录提示词文本，不拉整仓。
const SOURCES = [
  {
    match: /^codex-rs\/core\/([^/]+_prompt\.md)$/,
    target: (match) => `reference/codex/${match[1]}`,
  },
  {
    match: /^codex-rs\/prompts\/templates\/(.+\.(?:md|xml))$/,
    target: (match) => `reference/codex/${match[1]}`,
  },
  {
    match: /^codex-rs\/models-manager\/prompt\.md$/,
    target: () => 'reference/codex/models-manager/prompt.md',
  },
  {
    match: /^codex-rs\/models-manager\/models\.json$/,
    target: () => 'reference/codex/models-manager/models.json',
  },
  {
    match: /^codex-rs\/protocol\/src\/prompts\/base_instructions\/default\.md$/,
    target: () => 'reference/codex/base_instructions/default.md',
  },
]

/** 上游文件列表 → 本地归档清单，按本地路径排序。 */
export function selectTrackedFiles(paths) {
  const files = []
  const seen = new Set()

  for (const upstream of paths) {
    for (const source of SOURCES) {
      const match = source.match.exec(upstream)
      if (!match) continue

      const local = source.target(match)
      if (!local.startsWith('reference/codex/') || local.split('/').includes('..')) {
        throw new Error(`拒绝写入非法归档路径: ${local}`)
      }
      if (seen.has(local)) throw new Error(`上游文件映射重复: ${local}`)
      seen.add(local)
      files.push({ upstream, local })
      break
    }
  }

  return files.sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0))
}

export function parseArgs(argv) {
  const options = {
    write: false,
    prune: false,
    ref: defaultRef,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--write' || arg === '--sync') options.write = true
    else if (arg === '--check') options.write = false
    else if (arg === '--prune') options.prune = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--ref') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-')) throw new Error('--ref 需要一个分支、标签或提交')
      options.ref = value
      index += 1
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }

  if (options.prune && !options.write) throw new Error('--prune 只能与 --write 一起使用')
  return options
}

function git(args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })

  if (result.error) throw new Error(`执行 git 失败: ${result.error.message}`)
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr
    throw new Error(`git ${args.join(' ')} 失败:\n${(stderr || '').trim()}`)
  }
  return result.stdout
}

function ensureCache(ref) {
  if (!existsSync(join(cacheDir, '.git'))) {
    if (existsSync(cacheDir)) {
      throw new Error(`缓存目录不完整，请先删除后重试: ${cacheDir}`)
    }
    mkdirSync(dirname(cacheDir), { recursive: true })
    process.stderr.write(`首次同步：初始化 ${repoUrl} 的本地缓存...\n`)
    git(['clone', '--quiet', '--filter=blob:none', '--no-checkout', '--depth', '1', repoUrl, cacheDir])
  }

  process.stderr.write(`获取上游 ${ref}...\n`)
  git(['-C', cacheDir, 'fetch', '--quiet', '--depth', '1', 'origin', ref])
  return git(['-C', cacheDir, 'rev-parse', 'FETCH_HEAD^{commit}']).trim()
}

function readManifest() {
  if (!existsSync(manifestPath)) {
    return { version: 1, repository: repoUrl, ref: defaultRef, commit: null, files: {} }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!manifest || typeof manifest !== 'object' || !manifest.files) {
    throw new Error(`清单格式不正确: ${manifestPath}`)
  }
  return manifest
}

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function readLocal(relativePath) {
  const absolutePath = join(root, relativePath)
  return existsSync(absolutePath) ? readFileSync(absolutePath) : null
}

function buildPlan(commit) {
  const paths = git(['-C', cacheDir, 'ls-tree', '-r', '--name-only', commit])
    .split('\n')
    .filter(Boolean)
  const tracked = selectTrackedFiles(paths)
  const manifest = readManifest()
  const trackedPaths = new Set(tracked.map((file) => file.local))
  const changes = []

  for (const file of tracked) {
    const expected = git(['-C', cacheDir, 'show', `${commit}:${file.upstream}`], null)
    const actual = readLocal(file.local)
    let status = 'same'
    if (!actual) status = 'added'
    else if (!actual.equals(expected)) status = 'changed'
    changes.push({ ...file, status, expected, bytes: expected.length })
  }

  const stale = Object.keys(manifest.files)
    .filter((local) => !trackedPaths.has(local))
    .filter((local) => existsSync(join(root, local)))
    .sort()

  return { commit, tracked, changes, stale, manifest }
}

function renderHuman(plan, options, checking) {
  const changed = plan.changes.filter((file) => file.status !== 'same')
  const count = changed.length + plan.stale.length
  const commit = plan.commit.slice(0, 12)

  process.stdout.write(`上游 openai/codex@${commit} (${options.ref})\n`)
  if (!count) {
    process.stdout.write('reference/codex 已是最新。\n')
    if (!existsSync(manifestPath)) {
      process.stdout.write('缺少 reference/upstream.json，运行 npm run upstream:sync 生成。\n')
    } else if (plan.manifest.commit !== plan.commit) {
      process.stdout.write(`清单记录的是 ${String(plan.manifest.commit).slice(0, 12)}，运行 npm run upstream:sync 更新。\n`)
    }
    return 0
  }

  for (const file of changed) {
    const mark = file.status === 'added' ? '+' : '~'
    process.stdout.write(`${mark} ${file.local}\n`)
  }
  for (const local of plan.stale) process.stdout.write(`- ${local}\n`)
  process.stdout.write(`共 ${changed.length} 个新增/变更，${plan.stale.length} 个上游已移除。\n`)
  if (checking) {
    process.stdout.write('运行 npm run upstream:sync 写入归档。\n')
    return 1
  }
  return 0
}

function writePlan(plan, options) {
  const changed = plan.changes.filter((file) => file.status !== 'same')

  for (const file of changed) {
    const absolutePath = join(root, file.local)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, file.expected)
  }

  if (options.prune) {
    for (const local of plan.stale) {
      if (!local.startsWith('reference/codex/') || local.split('/').includes('..')) {
        throw new Error(`拒绝删除非法归档路径: ${local}`)
      }
      rmSync(join(root, local), { force: true })
    }
  }

  const files = {}
  for (const file of plan.changes) {
    files[file.local] = {
      upstream: file.upstream,
      sha256: hash(file.expected),
      bytes: file.bytes,
    }
  }
  if (!options.prune) {
    for (const local of plan.stale) {
      if (plan.manifest.files[local]) files[local] = plan.manifest.files[local]
    }
  }

  const manifest = {
    version: 1,
    repository: repoUrl,
    ref: options.ref,
    commit: plan.commit,
    files,
  }

  const manifestChanged =
    !existsSync(manifestPath) ||
    JSON.stringify(plan.manifest) !== JSON.stringify(manifest)
  if (manifestChanged) {
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  return { files: changed.length, pruned: options.prune ? plan.stale.length : 0, manifestChanged }
}

export function formatJson(plan, options, checking) {
  const changed = plan.changes.filter((file) => file.status !== 'same')
  return {
    ok: changed.length === 0 && plan.stale.length === 0,
    checking,
    ref: options.ref,
    commit: plan.commit,
    changes: changed.map(({ local, upstream, status, bytes }) => ({ local, upstream, status, bytes })),
    stale: plan.stale,
  }
}

function help() {
  return `用法: node scripts/sync-upstream.mjs [选项]

选项:
  --check         只检查差异（默认）
  --write, --sync 写入 reference/codex/ 并更新 reference/upstream.json
  --prune         删除上游已移除、且上次同步过的旧文件（需配合 --write）
  --ref <ref>     上游分支、标签或提交，默认 main
  --json          以 JSON 输出结果
  -h, --help      显示本帮助
`
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${help()}`)
    process.exitCode = 2
    return
  }

  if (options.help) {
    process.stdout.write(help())
    return
  }

  try {
    const commit = ensureCache(options.ref)
    const plan = buildPlan(commit)

    if (options.json) {
      process.stdout.write(`${JSON.stringify(formatJson(plan, options, !options.write), null, 2)}\n`)
    } else {
      renderHuman(plan, options, !options.write)
    }

    if (options.write) {
      const written = writePlan(plan, options)
      if (!options.json) {
        process.stdout.write(
          `已写入 ${written.files} 个文件，删除 ${written.pruned} 个旧文件，清单${written.manifestChanged ? '已更新' : '未变'}。\n`,
        )
      }
    } else if (plan.changes.some((file) => file.status !== 'same') || plan.stale.length) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
