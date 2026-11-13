/**
 * Mount the official macOS Computer Use provider when the bundle component is
 * enabled. The provider is global so both the Codex preset and PTC preset can
 * use the `cua` tool.
 */

export const name = 'computer-use';

export async function apply(ctx, config) {
  if (process.platform !== 'darwin') return;

  const existing = ctx.get('computerUse');
  if (existing?.providerName) {
    throw new Error(
      'Computer Use provider is already registered; disable the official Computer Use bundle before enabling this component.',
    );
  }

  if (!existing) {
    const { ComputerUseRegistry } = await import('@deepseek-ai/dsh-computer-use');
    await ctx.plugin(ComputerUseRegistry);
  }

  const provider = await import('@deepseek-ai/dsh-experimental-cua-macos');
  await ctx.plugin(provider, { ...config, agentPreset: false });
}
