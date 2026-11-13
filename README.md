# dsh-preset-codex

把 Codex 的提示词适配成 DeepSeek Harness 的 Agent 预设，以 bundle 分发。安装后在「设置 → Agent 预设 → 自定义」里出现 **Codex**，新建任务时可直接选用。

## 安装

bundle 装在 profile 里，Web 与 Desktop 是两套 profile，要各装一次。命令都走 pnpm，`pnpm` 不在 `PATH` 上会直接退出（127）。

按包名安装要求这个包已经发布到 npm；还没发布时用下面「本地开发」那节的路径写法。

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

bundle 的 patch 只在启动时合成为入口列表：新装、改 bundle 里的 YAML、升级版本，都要重启 dsh（Desktop 重新打开）才生效。`dsh plugin add` 会改写 profile 的 `dsh.profile.bundles`，但这不会触发 bundle 层的重新合成。

## Computer Use（可选，仅 macOS）

本 bundle 在插件详情页内置一个默认关闭的 Computer Use 组件 `dsh-preset-codex/plugins/computer-use.js`。macOS 上打开它后，会挂载官方 macOS provider，并以 `agentPreset: false` 注册，因此 Codex 预设和 PTC 预设都能使用 `cua` 工具与指引；关闭组件后 provider 和工具一并卸载。

1. 安装本 bundle 后重启 dsh（Desktop 重新打开）。
2. 打开 **设置 → 插件**，进入 `dsh-preset-codex` 详情页，在「包含的组件」里打开 `dsh-preset-codex/plugins/computer-use.js`。
3. 首次使用按系统提示完成辅助功能与屏幕录制授权。
4. 官方 **Computer Use** 组合包不要同时启用：两者注册同一个独占 provider；如果已经启用，先关闭官方组合包，再打开本组件。

非 macOS 上组件行仍会显示，但打开后不会加载 provider。当前单 bundle 方案不能按平台条件隐藏这一行。

## 预设说明

Codex 模式把一套工程纪律压进系统提示词，改变的是行为而不是能力：动手前先读仓库的布局、约定和构建测试命令；过程中用短句说明在做什么、发现了什么，闷头连调工具时用户也跟得上；出问题追到根因，不用重试或兜底掩盖；改动贴着周边代码，不做顺手重构；交付时说清改了什么、怎么验证的、哪条路还没验。提示词以 `gpt-6.1-sol` 的 `instructions_template` 为唯一蓝本，旧 5.x prompt 只作 DSH 缺口补丁参考。工具面与 `standard` 几乎相同（差别只有五处，见下节，其中四处改变运行行为），所以它的不同几乎全部来自提示词和这两个本地插件。

**适合**：在真实仓库里做多文件改动、排查缺陷、补测试、做代码审查，以及需要连续跑很多步的长任务。

**不适合**：需要边跑边改 DSH 自身插件与配置的任务——那类工作用「创造模式」，本预设刻意不带 `tool-plugin-manager` 与 `tool-plugin-market`。

## 如何使用

1. 装完并重启 dsh，打开 **设置 → Agent 预设**，在「自定义」分组里找到 **Codex** 卡片：卡片上就是它的名字和一句话说明。
2. **想让它成为默认**：点这张卡片，状态变成「新任务默认」，之后新建的任务都用它。点回「标准模式」即可恢复。
3. **只想这一次用它**：新建任务时，在预设选择器里选 Codex，这个任务用它，不改默认值。
4. 预设随任务确定：卡片和选择器都只作用于「接下来创建的任务」，已经在跑的会话不受影响；会话跑起来之后也不能中途换，要换只能新建任务。

## 预设内容

23 条插件行，与 dsh 自带的 `standard` 预设同构，只改五处：

- `persona`：Codex 风格的身份、工作方式与交付格式
- `tool-todo`：`allowParallelInProgress: false`，同一时刻只有一个进行中
- `todo-reminder`：本地插件，把 `todo_write` 的完整清单回显给模型，并在持续工作时每 4 次工具调用提醒一次
- `commentary-nudge`：本地插件，检查每个用户可见的 root 工具批次的 owning assistant message；如果第一个 tool-call 之前没有正文，就在该批最后一个可见结果上注入一条 notice，提醒下一批在同一个 assistant message 里补 1–2 句。不拦工具、不出错误行、不设定时器；同一段沉默最多提醒一次，出现正文或进入新 turn 后重置。交互工具、`compress`/`wait_agent` 和 nested call 跳过。`enabled: false` 可关闭，退回提示词约束
- 去掉 `tool-plugin-manager` 与 `tool-plugin-market`：编码 Agent 不该顺手改自己的运行时

最后一条与 `standard` 的差别只在写法：`standard` 也把这两行标成 `disabled: true`，运行效果相同。所以真正改变行为的只有前四条。

播报要能被看见，还依赖 Web 端的一个设置：**设置 → 通用设置 → 收起后显示的回复** 保持默认的「全部回复」。选「仅最终回答」时，过程里的回复会随工具调用一起折进「已完成，用时 …」，提示词和插件都在正常工作，但界面上看不到。

### commentary nudge 的已知限制

DSH 没有原生 commentary 通道，插件只能检查同一条 assistant message 里、第一个 tool-call 之前的 `text`。reasoning、工具 `description`、上一条消息都不算正文。软提醒不会拦截工具：没有正文的批次会先跑完，插件在该批最后一个可见结果上注入一条 notice，提醒下一批在同一个 assistant message 里补 1–2 句。`compress`/`wait_agent`、交互工具和 nested call 跳过；同一段沉默最多提醒一次，出现可见正文或进入新 turn 后重置。代价是第一批可能已经在没有正文的情况下执行完，notice 不可能补到它前面。`enabled: false` 可完全关闭。真正的解法是 DSH core 提供 commentary phase。

## 目录结构

```
.
├─ cordis.patch.yml         # 产物：bundle 加载的 patch，勿手改
├─ package.json             # dsh.manifestVersion / dsh.bundle.patch / exports / files / engines
├─ AGENTS.md                # 维护准则：改这个仓库之前先读
├─ LICENSE
├─ icon.svg
├─ locale/{en,zh}.json      # 插件卡片的 meta.title / meta.description
├─ plugins/todo-reminder.js # 本地提醒插件：todo 清单回显与定期提醒
├─ plugins/commentary-nudge.js # 本地插件：批次后播报提醒；缺正文时在批末注入 notice，不拦截
├─ plugins/computer-use.js  # 本地插件：macOS Computer Use 开关，默认关闭，挂官方 provider
├─ src/
│  ├─ preset.template.yml   # 源码：预设骨架 + 两个 persona 占位符
│  └─ persona/{prefix,suffix}.md
├─ test/{artifact,commentary-nudge,todo-reminder,upstream}.test.mjs # 零依赖测试：产物新鲜度、预设行、元数据契约、插件行为、同步映射
├─ reference/codex/         # 上游提示词存档（不参与构建、不进包）
├─ reference/upstream.json  # 上次同步的上游提交与文件清单
├─ docs/adaptation.md       # 与上游的逐条映射
└─ scripts/{build,sync-upstream}.mjs # 零依赖构建 / 上游提示词同步
```

## 构建

```bash
node scripts/build.mjs           # 由 src/ 生成 cordis.patch.yml
node scripts/build.mjs --check   # 只比对，不一致退出码 1
npm test                         # 产物新鲜度 + 预设行 + 元数据契约
```

构建只做占位符替换：读 `src/persona/*.md`，以 YAML 块标量（`|`）写进模板。不解析 YAML、无第三方依赖，产物可逐字节复现。

**改提示词只改 `src/persona/*.md`，然后重新构建。**

## 跟踪上游

`reference/codex/` 是从 `openai/codex` 按需拉取的提示词快照，不参与构建，也不进 npm 包。同步脚本只用 Node 内置模块和系统 `git`，首次会把目录树缓存到 `.cache/codex-upstream/`（已 gitignore）。

```bash
npm run upstream:check              # 拉取上游最新提交，只报告差异；有差异退出码 1
npm run upstream:sync               # 把差异写入 reference/codex/，并更新 reference/upstream.json
npm run upstream:sync -- --ref <sha> # 指定分支、标签或提交
```

需要删除上游已移除、且上次同步过的旧文件时，给同步命令加 `--prune`。

## 本地化

`locale/*.json` 只作用于插件页那张 bundle 卡片。Agent 预设卡片上的名字与描述取自 `cordis.patch.yml`，而 dsh 对非内置预设**不做翻译**（`presetDisplayText` 直接返回声明文本），所以那里只能写一种语言。

本仓库让三处文案保持同一句话——产物里的 `description`、`locale/zh.json`、`package.json`——英文只出现在 `locale/en.json`。改文案时三处一起改，`npm test` 会盯着它们是否还一致。

## 升级

`src/preset.template.yml` 里的插件行是 `standard` 预设的快照。dsh 升级后对比 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`，把新增或改名的行同步进模板。

## 与上游的差异

见 [docs/adaptation.md](docs/adaptation.md)。一句话：工具名与 harness 描述全部换成 DSH 实际提供的工具，沙箱与审批说明交给运行时上下文，前端审美与 review 纪律保留。

## License

MIT，全文见 [LICENSE](LICENSE)。`reference/` 下的上游文本版权归原作者，不随本包分发。
