import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (name) => readFileSync(path.join(root, name), 'utf8');

const pkg = JSON.parse(read('package.json'));
const artifact = read('cordis.patch.yml');

/** 预设里挂的插件行，顺序即产物顺序；改动这个列表等于改预设内容。 */
const EXPECTED_PLUGINS = [
  'persona',
  'agent-instructions',
  'time-context',
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
  'tool-jobs',
  'tool-schedule',
  'skill-filesystem',
  'tool-skill',
  'command-goal',
  'tool-goal',
  'planning',
  'compaction',
  'delegation',
  'tool-ask-user',
  'tool-todo',
  'todo-reminder',
  'tool-web',
  'present',
];

test('产物与源码一致（build --check 通过）', () => {
  const out = execFileSync(process.execPath, ['scripts/build.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(out, /已是最新/);
});

test('预设声明的必填与可选字段都在', () => {
  assert.match(artifact, /^ {4}- id: preset-codex$/m);
  assert.match(artifact, /^ {6}name: '@deepseek-ai\/dsh-agent-preset'$/m);
  assert.match(artifact, /^ {8}id: codex$/m);
  assert.match(artifact, /^ {8}name: Codex$/m);
  assert.match(artifact, /^ {8}order: \d+$/m);
  assert.match(artifact, /^ {8}description: \S/m);
});

test('插件行与预期清单逐条一致', () => {
  const ids = artifact
    .split('\n')
    .filter((line) => /^ {10}- id: /.test(line))
    .map((line) => line.trim().slice('- id: '.length));
  assert.deepEqual(ids, EXPECTED_PLUGINS);
});

test('persona 占位符已被替换成正文', () => {
  assert.ok(!artifact.includes('__PERSONA_'), '产物里仍有未替换的占位符');
  assert.match(artifact, /## How to work/);
  assert.match(artifact, /Then stop/);
});

test('四处与 standard 的刻意差异仍在', () => {
  assert.match(artifact, /^ {14}allowParallelInProgress: false$/m);
  assert.match(artifact, /^ {12}name: 'dsh-preset-codex\/plugins\/todo-reminder\.js'$/m);
  assert.ok(!artifact.includes('dsh-tool-plugin-manager'));
  assert.ok(!artifact.includes('dsh-tool-plugin-market'));
});

test('本地 todo 提醒插件随包发布且可加载', async () => {
  assert.ok(existsSync(path.join(root, 'plugins/todo-reminder.js')));
  assert.ok(pkg.files.includes('plugins/*.js'));
  assert.ok('./plugins/*.js' in pkg.exports);
  const plugin = await import(`${pkg.name}/plugins/todo-reminder.js`);
  assert.equal(typeof plugin.apply, 'function');
});

test('locale 覆盖同一组语言，且 meta 字段非空', () => {
  const languages = readdirSync(path.join(root, 'locale'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.basename(name, '.json'));
  assert.deepEqual(languages.sort(), ['en', 'zh']);

  for (const lang of languages) {
    const meta = JSON.parse(read(`locale/${lang}.json`)).meta;
    assert.equal(typeof meta.title, 'string', `${lang}: meta.title`);
    assert.ok(meta.title.length > 0, `${lang}: meta.title 为空`);
    assert.equal(typeof meta.description, 'string', `${lang}: meta.description`);
    assert.ok(meta.description.length > 0, `${lang}: meta.description 为空`);
  }
});

test('预设卡文案与 locale 文案是同一句话', () => {
  const declared = artifact.match(/^ {8}description: (.+)$/m)[1].trim();
  const zh = JSON.parse(read('locale/zh.json')).meta.description;
  assert.equal(declared, zh);
  assert.equal(pkg.description, zh);
});

test('icon 在 dsh 的上限之内且是合法 SVG', () => {
  const file = path.join(root, 'icon.svg');
  const bytes = statSync(file).size;
  assert.ok(bytes <= 256 * 1024, `icon ${bytes} 字节，超过 256 KiB 上限`);
  const svg = readFileSync(file, 'utf8');
  assert.match(svg, /^<svg[\s>]/);
  assert.match(svg, /viewBox="0 0 64 64"/);
});

test('manifest 声明了 bundle 与格式版本', () => {
  assert.equal(pkg.dsh.manifestVersion, 1);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'files 未包含产物');
  assert.ok(statSync(path.join(root, pkg.dsh.bundle.patch)).isFile());
});

test('exports 覆盖 dsh 读取元数据所需的三个入口', () => {
  assert.equal(pkg.exports['./package.json'], './package.json');
  assert.equal(pkg.exports['./icon'], './icon.svg');
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json');
});

test('发版前会先跑构建校验与测试', () => {
  assert.match(pkg.scripts.prepublishOnly, /build\.mjs --check/);
  assert.match(pkg.scripts.prepublishOnly, /--test/);
});

/** 从产物里取回块标量的正文，用来验证注入没有改写内容。 */
function blockScalar(name) {
  const lines = artifact.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^ *${name}: \\|$`).test(line));
  assert.notEqual(start, -1, `产物里找不到 ${name}: |`);
  const indent = lines[start].match(/^ */)[0].length + 2;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (line.match(/^ */)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n').replace(/[\s\uFEFF]+$/, '');
}

test('注入的 persona 与源文件逐字一致', () => {
  for (const name of ['prefix', 'suffix']) {
    const source = read(`src/persona/${name}.md`)
      .replace(/\r\n/g, '\n')
      .replace(/[\s\uFEFF]+$/, '');
    assert.equal(blockScalar(name), source, `${name} 注入后与源文件不一致`);
  }
});

const persona = ['prefix', 'suffix'].map((name) => read(`src/persona/${name}.md`)).join('\n');

test('persona 不引用上游专有工具名', () => {
  for (const token of ['apply_patch', 'update_plan', 'multi_tool_use']) {
    assert.ok(!persona.includes(token), `persona 里仍有上游工具名 ${token}`);
  }
});

test('persona 词数不超过预算', () => {
  const words = persona.split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 2000, `persona 有 ${words} 词，超出 2000 的预算`);
});

/** 已安装的 dsh 根目录；找不到就跳过解析检查（仓库本身零依赖，不假定 dsh 在哪）。 */
function installedDshRoot() {
  const candidates = [process.env.DSH_INSTALL_ROOT];
  try {
    const prefix = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    candidates.push(path.join(prefix, '@deepseek-ai', 'dsh'));
  } catch {}
  candidates.push(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  return candidates.find((dir) => dir && existsSync(path.join(dir, 'package.json')));
}

/** '@scope/pkg/sub' → ['@scope/pkg', 'sub']；'@scope/pkg' → ['@scope/pkg', '']。 */
function splitSpecifier(name) {
  const parts = name.split('/');
  return name.startsWith('@')
    ? [parts.slice(0, 2).join('/'), parts.slice(2).join('/')]
    : [parts[0], parts.slice(1).join('/')];
}

test('插件名在已安装的 dsh 中可解析', (t) => {
  const dshRoot = installedDshRoot();
  if (!dshRoot) return t.skip('未找到已安装的 dsh');
  const version = JSON.parse(readFileSync(path.join(dshRoot, 'package.json'), 'utf8')).version;
  const names = [...new Set([...artifact.matchAll(/name: '([^']+)'/g)].map((m) => m[1]))]
    .filter((name) => name !== 'cordis:group')
    .filter((name) => !name.startsWith('.') && !path.isAbsolute(name))
    .filter((name) => name !== `${pkg.name}/plugins/todo-reminder.js`);
  const missing = [];
  for (const name of names) {
    const [pkgName, sub] = splitSpecifier(name);
    const manifest = path.join(dshRoot, 'node_modules', pkgName, 'package.json');
    if (!existsSync(manifest)) {
      missing.push(`${name}（包不存在）`);
      continue;
    }
    if (!sub) continue;
    const { exports: ex } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (!ex || !ex[`./${sub}`]) missing.push(`${name}（exports 里没有 ./${sub}）`);
  }
  assert.deepEqual(missing, [], `dsh ${version} 中解析失败`);
});
