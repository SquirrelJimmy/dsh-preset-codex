# dsh-preset-codex-cua

仅 macOS 的 DSH 组合包，用来在 Codex 预设里使用 Computer Use，同时保留 PTC 会话的 Computer Use。

官方 `@deepseek-ai/dsh-cua-bundle` 把 `cua` provider 的 `agentPreset` 固定为 `ptc`。本包是一个纯 patch 扩展，用同 id 覆盖那一行：

```yaml
- id: cua
  name: '@deepseek-ai/dsh-experimental-cua-macos'
  config:
    agentPreset: false
```

`agentPreset: false` 表示全局注册，所以开启本包后所有 Agent 预设（包括 Codex 和 PTC）都能使用 `cua`；关闭本包后恢复官方默认的 `ptc` 绑定。

## 前提

- macOS 上的 DSH，且已安装并可运行官方 `@deepseek-ai/dsh-cua-bundle`。
- 先在「设置 → 插件」中启用官方 **Computer Use**，并按提示完成辅助功能与屏幕录制授权。
- 本包只改变 `agentPreset`，不修改官方包或 DSH 核心。

## 安装

Desktop 的 profile 由 Desktop 自己创建，先打开一次让它初始化，再**完全退出**，然后从仓库根目录的 `cua/` 子包安装：

```bash
dsh plugin --profile desktop add /path/to/dsh-preset-codex/cua
```

发布到 npm 后也可以按包名安装：

```bash
dsh plugin --profile desktop add dsh-preset-codex-cua
```

安装后重新打开 Desktop。bundle 的 patch 只在启动时合成，修改本包或升级版本后都要重新启动 Desktop。

## 开关行为

- **安装后默认启用**：DSH 会把新安装的组合包加入 profile 的 `dsh.profile.bundles`；可在「设置 → 插件」的 `Codex 电脑操作` 卡片里关闭。
- **开启时**：所有 Agent 预设都获得 `cua` 工具和 Computer Use 指引。
- **关闭时**：本包补丁不再生效，`cua` 回到官方默认的 `ptc` 绑定；Codex 预设不再获得 CUA，PTC 仍可用。
- **非 macOS**：`dsh.bundle.platforms` 只为 `darwin`；其他平台的插件页默认不显示，安装时返回 `unsupported-platform`。

## 顺序与覆盖

Loader 按 profile 的 `dsh.profile.bundles` 顺序应用 bundle 层，后层覆盖同 id 行。因此：

1. 先启用官方 Computer Use；
2. 再安装/启用本包，让本包排在官方包之后；
3. 如果之后关闭并重新启用官方 Computer Use，官方包会追加到列表末尾，需要把本包也关一次再开，恢复覆盖顺序。

如果 profile 或 home patch 中已有 `cua` 的显式覆盖，它会盖过本包的 bundle 层。要自定义 `allowedApps` 等字段时，请把 `agentPreset: false` 写进同一个覆盖里：

```yaml
- id: cua
  name: '@deepseek-ai/dsh-experimental-cua-macos'
  config:
    agentPreset: false
    allowedApps: [...]
```

## 升级检查

本包只重述 `agentPreset`。如果 DSH 升级后官方 `cua` 行新增了必填配置字段，需要对照官方 `cordis.patch.yml` 把新字段补进本包；如果 provider 包名或行 id 变化，本包会告警并跳过。升级后请重新跑仓库测试。
