/**
 * Mount the official macOS Computer Use provider when the bundle component is
 * enabled. The provider is global so both the Codex preset and PTC preset can
 * use the `cua` tool.
 */

const PROVIDER_PACKAGE = '@deepseek-ai/dsh-experimental-cua-macos'
const REGISTRY_PACKAGE = '@deepseek-ai/dsh-computer-use'

export const name = 'computer-use';

function findProviderEntry(ctx) {
  for (const entry of ctx.loader.entries()) {
    if (entry.options?.name === PROVIDER_PACKAGE) return entry;
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

async function restoreProviderEntry(ctx, entry, originalDisabled) {
  if (!entry) return;
  try {
    await entry.update({ disabled: originalDisabled });
  } catch (error) {
    ctx.logger?.warn?.(error);
  }
}

async function disableProviderEntry(entry, disabledEntries) {
  if (!entry || entry.disabled) return;
  const originalDisabled = entry.options?.disabled;
  await entry.update({ disabled: true });
  disabledEntries.push({ entry, originalDisabled });
}

export async function apply(ctx, config) {
  if (process.platform !== 'darwin') return;

  const providerEntry = findProviderEntry(ctx);
  const disabledEntries = [];
  const mounted = [];
  let ownRegistry = false;

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

  try {
    // The official bundle starts its provider first. Stop that entry before
    // mounting ours so the exclusive `computerUse` registry can be reused.
    await disableProviderEntry(providerEntry, disabledEntries);

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
      ownRegistry = true;
    }

    const provider = await ctx.loader.import(PROVIDER_PACKAGE);
    mounted.push(await ctx.plugin(provider, { ...config, agentPreset: false }));

    // If the official bundle is enabled later, stop its duplicate provider
    // (and its registry when ours won the service slot) before it can start.
    ctx.on('loader/entry-init', (entry) => {
      const moduleName = entry.options?.name;
      const duplicate = moduleName === PROVIDER_PACKAGE
        || (ownRegistry && moduleName === REGISTRY_PACKAGE);
      if (!duplicate || entry.disabled) return;
      void disableProviderEntry(entry, disabledEntries).catch((error) => ctx.logger?.warn?.(error));
    });

    ctx.effect(() => async () => {
      await disposeMounted();
      for (const { entry, originalDisabled } of [...disabledEntries].reverse()) {
        await restoreProviderEntry(ctx, entry, originalDisabled);
      }
    });
  } catch (error) {
    await disposeMounted();
    for (const { entry, originalDisabled } of [...disabledEntries].reverse()) {
      await restoreProviderEntry(ctx, entry, originalDisabled);
    }
    throw new Error(
      `Computer Use is unavailable: enable the official Computer Use bundle or check the DSH installation. ${error?.message ?? error}`,
      { cause: error },
    );
  }
}
