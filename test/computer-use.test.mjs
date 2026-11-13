import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../plugins/computer-use.js';

function makeContext({ entries = [], provider = undefined, modules = {}, calls = [] } = {}) {
  return {
    logger: { warn() {} },
    loader: {
      entries: () => entries,
      async import(name) {
        calls.push({ type: 'import', name });
        if (!(name in modules)) throw new Error(`unexpected import: ${name}`);
        return modules[name];
      },
    },
    get(name) {
      return name === 'computerUse' ? provider : undefined;
    },
    async plugin(plugin, config) {
      calls.push({ type: 'plugin', plugin, config });
      return { dispose: async () => {} };
    },
    on() {},
    effect(execute) {
      const cleanup = execute();
      calls.push({ type: 'effect', cleanup });
      return { dispose: async () => {} };
    },
  };
}

function makeProviderEntry({ disabled = false, config = { agentPreset: 'ptc' }, calls = [] } = {}) {
  const entry = {
    options: { name: '@deepseek-ai/dsh-experimental-cua-macos', disabled, config },
    get disabled() {
      return entry.options.disabled;
    },
    async update(options) {
      calls.push({ type: 'entry-update', options });
      Object.assign(entry.options, options);
      if (options.disabled === true) providerRegistered = false;
    },
  };
  let providerRegistered = disabled === false;
  return { entry, isRegistered: () => providerRegistered };
}

async function withDarwin(fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'darwin' });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}

test('无官方 provider 时通过 Loader 导入并挂载 registry 与 provider', async () => {
  const calls = [];
  const context = makeContext({
    calls,
    modules: {
      '@deepseek-ai/dsh-computer-use': { ComputerUseRegistry: class Registry {} },
      '@deepseek-ai/dsh-experimental-cua-macos': { name: 'provider' },
    },
  });

  await withDarwin(() => apply(context, {}));

  assert.deepEqual(
    calls.filter((call) => call.type === 'import').map((call) => call.name),
    ['@deepseek-ai/dsh-computer-use', '@deepseek-ai/dsh-experimental-cua-macos'],
  );
  const pluginCalls = calls.filter((call) => call.type === 'plugin');
  assert.equal(pluginCalls.length, 2);
  assert.equal(pluginCalls[1].config.agentPreset, false);
});

test('官方 provider 已启用时先停用，再挂载本组件的 provider，清理时恢复', async () => {
  const calls = [];
  const { entry } = makeProviderEntry({ calls });
  const context = makeContext({
    calls,
    entries: [entry],
    provider: { get providerName() { return undefined; } },
    modules: {
      '@deepseek-ai/dsh-experimental-cua-macos': { name: 'provider' },
    },
  });

  await withDarwin(() => apply(context, {}));

  assert.deepEqual(calls.find((call) => call.type === 'entry-update')?.options, { disabled: true });
  assert.equal(entry.options.disabled, true);
  assert.equal(calls.filter((call) => call.type === 'plugin').length, 1);

  const cleanup = calls.find((call) => call.type === 'effect').cleanup;
  await cleanup();
  assert.equal(entry.options.disabled, false);
});

test('非 macOS 不导入、不挂载任何插件', async () => {
  const calls = [];
  const context = makeContext({ calls });

  await apply(context, {});

  assert.equal(calls.length, 0);
});
