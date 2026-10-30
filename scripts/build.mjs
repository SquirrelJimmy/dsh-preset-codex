#!/usr/bin/env node
// 把 src/ 下的源码编译成根目录的 cordis.patch.yml。
//
// 输入：src/preset.template.yml（预设骨架，persona 两段留占位符）
//       src/persona/prefix.md / suffix.md（真正的提示词文本）
// 输出：cordis.patch.yml
//
// 用法：node scripts/build.mjs          写入产物
//       node scripts/build.mjs --check  只比对，不一致则退出码 1
//
// 零依赖：不解析 YAML，只做占位符替换与缩进，产物格式可预期。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT = 'cordis.patch.yml'
const TEMPLATE = 'src/preset.template.yml'

const SOURCES = {
  __PERSONA_PREFIX__: 'src/persona/prefix.md',
  __PERSONA_SUFFIX__: 'src/persona/suffix.md',
}

const HEADER = [
  '# dsh-preset-codex —— 由 scripts/build.mjs 生成，请勿手改',
  '# 源码：src/preset.template.yml + src/persona/{prefix,suffix}.md',
  '# 重建：node scripts/build.mjs    校验：node scripts/build.mjs --check',
  '',
  '',
].join('\n')

const read = (rel) => readFileSync(join(root, rel), 'utf8')

/** 一段文本 → YAML 块标量内容（缩进到 indent，空行保持空行）。 */
function block(text, indent) {
  const body = text.replace(/\r\n/g, '\n').replace(/[\s\uFEFF]+$/, '')
  if (!body.trim()) throw new Error('源码文本为空')
  const pad = ' '.repeat(indent)
  return body
    .split('\n')
    .map((line) => (line.length ? pad + line : ''))
    .join('\n')
}

/** 把 `key: __TOKEN__` 换成 `key: |` + 缩进后的文本。 */
function inject(template, token, text) {
  const re = new RegExp(`^( *)([\\w-]+): ${token}$`, 'm')
  const match = template.match(re)
  if (!match) throw new Error(`模板里找不到占位符 ${token}`)
  const [, indent, key] = match
  const body = block(text, indent.length + 2)
  return template.replace(re, `${indent}${key}: |\n${body}`)
}

function render() {
  let out = read(TEMPLATE)
  for (const [token, file] of Object.entries(SOURCES)) out = inject(out, token, read(file))
  const leftover = Object.keys(SOURCES).filter((token) => out.includes(token))
  if (leftover.length) throw new Error(`占位符未替换：${leftover.join(', ')}`)
  return HEADER + out
}

const artifact = render()
const target = join(root, ARTIFACT)
// 只数 config.plugins 的直接子项（嵌套分组里的行不算插件行）。
const pluginsIndent = artifact.match(/^\s*plugins:\n(\s*)- id: /m)?.[1].length;
if (pluginsIndent === undefined) throw new Error("产物里找不到 config.plugins 列表")
const prefix = " ".repeat(pluginsIndent) + "- id: ";
const rows = artifact.split("\n").filter((line) => line.startsWith(prefix)).length

if (process.argv.includes('--check')) {
  if (!existsSync(target)) {
    console.error(`${ARTIFACT} 不存在，请先运行 node scripts/build.mjs`)
    process.exit(1)
  }
  if (readFileSync(target, 'utf8') !== artifact) {
    console.error(`${ARTIFACT} 与源码不一致，请重新构建`)
    process.exit(1)
  }
  console.log(`${ARTIFACT} 已是最新（${rows} 条插件行）`)
} else {
  writeFileSync(target, artifact)
  console.log(`已生成 ${ARTIFACT}（${rows} 条插件行，${artifact.length} 字符）`)
}
