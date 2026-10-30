import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

test('三处与 standard 的刻意差异仍在', () => {
  assert.match(artifact, /^ {14}allowParallelInProgress: false$/m);
  assert.ok(!artifact.includes('dsh-tool-plugin-manager'));
  assert.ok(!artifact.includes('dsh-tool-plugin-market'));
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
