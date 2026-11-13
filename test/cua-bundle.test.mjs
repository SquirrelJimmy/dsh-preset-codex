import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cuaRoot = path.join(root, 'cua');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('cua 扩展包的 manifest 契约完整', () => {
  const pkg = readJson(path.join(cuaRoot, 'package.json'));

  assert.equal(pkg.name, 'dsh-preset-codex-cua');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.dsh.manifestVersion, 1);
  assert.deepEqual(pkg.dsh.bundle.platforms, ['darwin']);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.ok(existsSync(path.join(cuaRoot, pkg.dsh.bundle.patch)));

  for (const file of ['index.js', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(file), `${file} 应在 files 中`);
  }
  assert.ok(pkg.files.includes('locale/*.json'));
  assert.match(pkg.optionalDependencies['@deepseek-ai/dsh-experimental-cua-macos'], /\^0\.2\.2-rc\.1/);
});

test('cua 扩展包只覆盖官方 provider 行的 agentPreset', () => {
  const patch = readFileSync(path.join(cuaRoot, 'cordis.patch.yml'), 'utf8');

  assert.match(patch, /^- id: cua$/m);
  assert.match(patch, /^ {2}name: '@deepseek-ai\/dsh-experimental-cua-macos'$/m);
  assert.match(patch, /^ {2}config:$/m);
  assert.match(patch, /^ {4}agentPreset: false$/m);
  assert.ok(!patch.split('\n').some((line) => line.trimStart().startsWith('insert:')));
});

test('cua 扩展包的中英文案都有 meta', () => {
  for (const locale of ['zh', 'en']) {
    const data = readJson(path.join(cuaRoot, 'locale', `${locale}.json`));
    assert.equal(typeof data.meta.title, 'string');
    assert.ok(data.meta.title.length > 0);
    assert.equal(typeof data.meta.description, 'string');
    assert.ok(data.meta.description.length > 0);
  }
  assert.deepEqual(readdirSync(path.join(cuaRoot, 'locale')).filter((file) => file.endsWith('.json')).sort(), ['en.json', 'zh.json']);
});

test('cua 扩展包的入口可作为空 ESM 加载', async () => {
  const module = await import(pathToFileURL(path.join(cuaRoot, 'index.js')).href);
  assert.deepEqual(Object.keys(module), []);
});

test('主预设产物没有被扩展包改动', () => {
  const artifact = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
  const rootPkg = readJson(path.join(root, 'package.json'));

  assert.equal(artifact.match(/^ {10}- id: /gm).length, 23);
  assert.ok(!rootPkg.files.some((file) => file.includes('cua')));
});
