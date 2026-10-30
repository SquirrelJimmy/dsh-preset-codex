# dsh-preset-codex

把 Codex 的提示词适配成 DeepSeek Harness 的 Agent 预设，以 bundle 分发。安装后在「设置 → Agent 预设 → 自定义」里出现 **Codex**，新建任务时可直接选用。

## 安装

bundle 装在 profile 里，Web 与 Desktop 是两套 profile，要各装一次。命令都走 pnpm，`pnpm` 不在 `PATH` 上会直接退出（127）。

**Web**

```bash
dsh plugin --profile web add dsh-preset-codex
```

**Desktop**

Desktop 的 profile 由 Desktop 自己创建，先打开一次让它初始化，再**完全退出**（官方要求：运行中的 Desktop 会占着 profile，装完再打开），然后：

```bash
dsh plugin --profile desktop add dsh-preset-codex
```

装完重新打开 Desktop。没打开过就执行会报 `Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before running dsh plugin --profile desktop.`

**本地开发**：直接把路径给 pnpm，用绝对路径（相对路径按当前目录解析）：

```bash
dsh plugin --profile web add /path/to/dsh-preset-codex
dsh plugin --profile desktop add /path/to/dsh-preset-codex
```

**其他 profile**：`--profile` 取 `$DSH_HOME/profiles` 下的名字，`dsh web`、`dsh headless` 对应的就是 `web`、`headless`。名字不存在时 dsh 会新建，但只带 `@deepseek-ai/dsh-base` 一层，app bundle 要自己补。

**卸载**：

```bash
dsh plugin --profile web remove dsh-preset-codex
dsh plugin --profile desktop remove dsh-preset-codex
```

bundle 的 patch 在启动时合成：改 bundle 里的 YAML 要重启才生效。新装时 `dsh plugin add` 会改写 profile 的 `dsh.profile.bundles`，开着 HMR 的 web profile 会因此触发一次重新组合，有可能免重启就出现；重启 dsh、重新打开 Desktop 仍是稳妥做法。

## 预设内容

20 条插件行，与 dsh 自带的 `standard` 预设同构，只改三处：

- `persona`：Codex 风格的身份、工作方式与交付格式
- `tool-todo`：`allowParallelInProgress: false`，同一时刻只有一个进行中
- 去掉 `tool-plugin-manager` 与 `tool-plugin-market`：编码 Agent 不该顺手改自己的运行时

## 目录结构

```
.
├─ cordis.patch.yml         # 产物：bundle 加载的 patch，勿手改
├─ package.json             # dsh.manifestVersion / dsh.bundle.patch / exports / files / engines
├─ AGENTS.md                # 维护准则：改这个仓库之前先读
├─ LICENSE
├─ icon.svg
├─ locale/{en,zh}.json      # 插件卡片的 meta.title / meta.description
├─ src/
│  ├─ preset.template.yml   # 源码：预设骨架 + 两个 persona 占位符
│  └─ persona/{prefix,suffix}.md
├─ test/artifact.test.mjs   # 零依赖测试：产物新鲜度、预设行、元数据契约
├─ reference/codex/         # 上游提示词存档（不参与构建、不进包）
├─ docs/adaptation.md       # 与上游的逐条映射
└─ scripts/build.mjs        # 零依赖构建
```

## 构建

```bash
node scripts/build.mjs           # 由 src/ 生成 cordis.patch.yml
node scripts/build.mjs --check   # 只比对，不一致退出码 1
npm test                         # 产物新鲜度 + 预设行 + 元数据契约
```

构建只做占位符替换：读 `src/persona/*.md`，以 YAML 块标量（`|`）写进模板。不解析 YAML、无第三方依赖，产物可逐字节复现。

**改提示词只改 `src/persona/*.md`，然后重新构建。**

## 本地化

`locale/*.json` 只作用于插件页那张 bundle 卡片。Agent 预设卡片上的名字与描述取自 `cordis.patch.yml`，而 dsh 对非内置预设**不做翻译**（`presetDisplayText` 直接返回声明文本），所以那里只能写一种语言。

本仓库让三处文案保持同一句话——产物里的 `description`、`locale/zh.json`、`package.json`——英文只出现在 `locale/en.json`。改文案时三处一起改，`npm test` 会盯着它们是否还一致。

## 升级

`src/preset.template.yml` 里的插件行是 `standard` 预设的快照。dsh 升级后对比 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`，把新增或改名的行同步进模板。

## 与上游的差异

见 [docs/adaptation.md](docs/adaptation.md)。一句话：工具名与 harness 描述全部换成 DSH 实际提供的工具，沙箱与审批说明交给运行时上下文，前端审美与 review 纪律保留。

## License

MIT，全文见 [LICENSE](LICENSE)。`reference/` 下的上游文本版权归原作者，不随本包分发。
