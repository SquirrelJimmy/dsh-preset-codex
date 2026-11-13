/**
 * Mount the official macOS Computer Use provider when the bundle component is
 * enabled. The provider is global so both the Codex preset and PTC preset can
 * use the `cua` tool.
 */

const PROVIDER_PACKAGE = '@deepseek-ai/dsh-experimental-cua-macos'
const REGISTRY_PACKAGE = '@deepseek-ai/dsh-computer-use'

export const name = 'computer-use';

function findEntry(ctx, moduleName) {
  for (const entry of ctx.loader.entries()) {
    if (entry.options?.name === moduleName) return entry;
  }
  return undefined;
}

async function disposeFiber(fiber) {
  if (!fiber || typeof fiber.dispose !== 'function') return;
  try {
    await fiber.dispose();
  } catch (error) {
    // The parent fiber may already have disposed a child during teardown.
    if (error?.message !== 'Fiber is already disposed') throw error;
  }
}

async function restoreEntry(ctx, entry, originalDisabled) {
  if (!entry) return;
  try {
    await entry.update({ disabled: originalDisabled });
  } catch (error) {
    ctx.logger?.warn?.(error);
  }
}

async function disableEntry(entry, disabledEntries) {
  if (!entry || entry.disabled) return;
  const originalDisabled = entry.options?.disabled;
  await entry.update({ disabled: true });
  disabledEntries.push({ entry, originalDisabled });
}

export async function apply(ctx, config) {
  if (process.platform !== 'darwin') return;

  const disabledEntries = [];
  const mounted = [];

  const disposeMounted = async () => {
    for (const fiber of [...mounted].reverse()) {
      try {
        await disposeFiber(fiber);
      } catch (error) {
        ctx.logger?.warn?.(error);
      }
    }
    mounted.length = 0;
  };

  const restoreEntries = async () => {
    for (const { entry, originalDisabled } of [...disabledEntries].reverse()) {
      await restoreEntry(ctx, entry, originalDisabled);
    }
  };

  // Register before the first await: the Loader creates and starts entries
  // concurrently, so an official registry entry may otherwise register the
  // same service while this plugin is still preparing its own.
  const removeEntryListener = ctx.on('loader/entry-init', (entry) => {
    const moduleName = entry.options?.name;
    if (moduleName !== PROVIDER_PACKAGE && moduleName !== REGISTRY_PACKAGE) return;
    if (entry.disabled) return;
    void disableEntry(entry, disabledEntries).catch((error) => ctx.logger?.warn?.(error));
  });

  const stopListening = () => {
    if (typeof removeEntryListener === 'function') removeEntryListener();
  };

  try {
    // The official bundle owns both the registry and provider rows. Stop the
    // provider first, then the registry, so the exclusive `computerUse` service
    // slot is free before this plugin mounts its own registry.
    await disableEntry(findEntry(ctx, PROVIDER_PACKAGE), disabledEntries);
    await disableEntry(findEntry(ctx, REGISTRY_PACKAGE), disabledEntries);

    const existing = ctx.get('computerUse');
    if (existing?.providerName) {
      throw new Error(
        `Computer Use provider "${existing.providerName}" is already registered; disable it before enabling this component.`,
      );
    }

    if (!existing) {
      const registry = await ctx.loader.import(REGISTRY_PACKAGE);
      const ComputerUseRegistry = registry.ComputerUseRegistry ?? registry.default;
      if (typeof ComputerUseRegistry !== 'function') {
        throw new Error(`Package ${REGISTRY_PACKAGE} did not export a Computer Use registry.`);
      }
      mounted.push(await ctx.plugin(ComputerUseRegistry));
    }

    const provider = await ctx.loader.import(PROVIDER_PACKAGE);
    mounted.push(await ctx.plugin(provider, { ...config, agentPreset: false }));

    ctx.effect(() => async () => {
      stopListening();
      await disposeMounted();
      await restoreEntries();
    });
  } catch (error) {
    stopListening();
    await disposeMounted();
    await restoreEntries();
    throw new Error(
      `Computer Use is unavailable: enable the official Computer Use bundle or check the DSH installation. ${error?.message ?? error}`,
      { cause: error },
    );
  }
}
