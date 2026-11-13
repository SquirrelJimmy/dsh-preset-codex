import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../plugins/computer-use.js';

const PROVIDER_PACKAGE = '@deepseek-ai/dsh-experimental-cua-macos';
const REGISTRY_PACKAGE = '@deepseek-ai/dsh-computer-use';

class Registry {}

function makeContext({ entries = [], provider = undefined, modules = {}, calls = [] } = {}) {
  let service = provider;
  const listeners = [];
  const context = {
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
      return name === 'computerUse' ? service : undefined;
    },
    setService(value) {
      service = value;
    },
    async plugin(plugin, config) {
      calls.push({ type: 'plugin', plugin, config });
      if (typeof plugin === 'function') service = { providerName: undefined };
      return { dispose: async () => {} };
    },
    on(event, callback) {
      calls.push({ type: 'on', event });
      listeners.push({ event, callback });
      return () => {
        const index = listeners.findIndex((item) => item.callback === callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    emit(event, payload) {
      for (const listener of [...listeners]) {
        if (listener.event === event) listener.callback(payload);
      }
    },
    effect(execute) {
      const cleanup = execute();
      calls.push({ type: 'effect', cleanup });
      return { dispose: async () => {} };
    },
  };
  return context;
}

function makeEntry({ name, disabled = false, config = {}, calls = [], onUpdate } = {}) {
  const entry = {
    options: { name, disabled, config },
    get disabled() {
      return entry.options.disabled;
    },
    async update(options) {
      calls.push({ type: 'entry-update', options });
      Object.assign(entry.options, options);
      await onUpdate?.(entry, options);
    },
  };
  return entry;
}

function makeProviderEntry(options = {}) {
  return makeEntry({ name: PROVIDER_PACKAGE, ...options });
}

function makeRegistryEntry({ context, ...options } = {}) {
  return makeEntry({
    name: REGISTRY_PACKAGE,
    ...options,
    onUpdate: (entry, next) => {
      if (next.disabled === true) context?.setService(undefined);
      options.onUpdate?.(entry, next);
    },
  });
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

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('无官方 provider 时通过 Loader 导入并挂载 registry 与 provider', async () => {
  const calls = [];
  const context = makeContext({
    calls,
    modules: {
      [REGISTRY_PACKAGE]: { ComputerUseRegistry: Registry },
      [PROVIDER_PACKAGE]: { name: 'provider' },
    },
  });

  await withDarwin(() => apply(context, {}));

  assert.deepEqual(
    calls.filter((call) => call.type === 'import').map((call) => call.name),
    [REGISTRY_PACKAGE, PROVIDER_PACKAGE],
  );
  const pluginCalls = calls.filter((call) => call.type === 'plugin');
  assert.equal(pluginCalls.length, 2);
  assert.equal(pluginCalls[0].plugin, Registry);
  assert.equal(pluginCalls[1].config.agentPreset, false);
});

test('官方 provider 已启用时先停用，再挂载本组件的 provider，清理时恢复', async () => {
  const calls = [];
  const providerEntry = makeProviderEntry({ calls });
  const context = makeContext({
    calls,
    entries: [providerEntry],
    provider: { get providerName() { return undefined; } },
    modules: {
      [PROVIDER_PACKAGE]: { name: 'provider' },
    },
  });

  await withDarwin(() => apply(context, {}));

  assert.deepEqual(calls.find((call) => call.type === 'entry-update')?.options, { disabled: true });
  assert.equal(providerEntry.options.disabled, true);
  assert.equal(calls.filter((call) => call.type === 'plugin').length, 1);

  const cleanup = calls.find((call) => call.type === 'effect').cleanup;
  await cleanup();
  assert.equal(providerEntry.options.disabled, false);
});

test('官方 provider 与 registry 同时启用时两行都停用，只保留一个 registry', async () => {
  const calls = [];
  const providerEntry = makeProviderEntry({ calls });
  const context = makeContext({
    calls,
    entries: [providerEntry],
    provider: { get providerName() { return undefined; } },
    modules: {
      [REGISTRY_PACKAGE]: { ComputerUseRegistry: Registry },
      [PROVIDER_PACKAGE]: { name: 'provider' },
    },
  });
  const registryEntry = makeRegistryEntry({ context, calls });
  context.loader.entries = () => [providerEntry, registryEntry];

  await withDarwin(() => apply(context, {}));

  assert.deepEqual(
    calls.filter((call) => call.type === 'entry-update').map((call) => call.options),
    [{ disabled: true }, { disabled: true }],
  );
  assert.equal(providerEntry.options.disabled, true);
  assert.equal(registryEntry.options.disabled, true);
  const pluginCalls = calls.filter((call) => call.type === 'plugin');
  assert.equal(pluginCalls.length, 2);
  assert.equal(pluginCalls[0].plugin, Registry);
});

test('官方 registry 已存在时复用现有服务，不再挂载第二个 registry', async () => {
  const calls = [];
  const context = makeContext({
    calls,
    provider: { get providerName() { return undefined; } },
    modules: {
      [PROVIDER_PACKAGE]: { name: 'provider' },
    },
  });

  await withDarwin(() => apply(context, {}));

  assert.equal(calls.some((call) => call.type === 'import' && call.name === REGISTRY_PACKAGE), false);
  assert.equal(calls.filter((call) => call.type === 'plugin').length, 1);
  assert.equal(calls.find((call) => call.type === 'plugin').plugin.name, 'provider');
});

test('官方 registry/provider 在 apply 后创建时由 entry-init 监听器停用', async () => {
  const calls = [];
  const context = makeContext({
    calls,
    modules: {
      [REGISTRY_PACKAGE]: { ComputerUseRegistry: Registry },
      [PROVIDER_PACKAGE]: { name: 'provider' },
    },
  });

  await withDarwin(() => apply(context, {}));

  const registryEntry = makeRegistryEntry({ context, calls });
  const providerEntry = makeProviderEntry({ calls });
  context.emit('loader/entry-init', registryEntry);
  context.emit('loader/entry-init', providerEntry);
  await tick();

  assert.equal(registryEntry.options.disabled, true);
  assert.equal(providerEntry.options.disabled, true);
});

test('关闭组件时恢复官方 registry 与 provider 的原始状态', async () => {
  const calls = [];
  const providerEntry = makeProviderEntry({ calls });
  const context = makeContext({
    calls,
    entries: [providerEntry],
    provider: { get providerName() { return undefined; } },
    modules: {
      [REGISTRY_PACKAGE]: { ComputerUseRegistry: Registry },
      [PROVIDER_PACKAGE]: { name: 'provider' },
    },
  });
  const registryEntry = makeRegistryEntry({ context, calls, disabled: true });
  context.loader.entries = () => [providerEntry, registryEntry];

  await withDarwin(() => apply(context, {}));

  const cleanup = calls.find((call) => call.type === 'effect').cleanup;
  await cleanup();
  assert.equal(providerEntry.options.disabled, false);
  assert.equal(registryEntry.options.disabled, true);
});

test('非 macOS 不导入、不挂载任何插件', async () => {
  const calls = [];
  const context = makeContext({ calls });

  await apply(context, {});

  assert.equal(calls.length, 0);
});
