# 与上游 Codex 提示词的对应关系

`reference/` 是上游提示词的原始存档，不参与构建。真正参与构建的是 `src/persona/prefix.md` 与 `src/persona/suffix.md`——它们是逐条判断后的适配结果，不是机械替换的产物。

处理按“新版 → DSH → 旧版”的顺序判断：先看新版蓝本要保留什么；DSH 有等价载体则**替换**，没有等价载体则降级到旧 5.x prompt 的对应做法再适配；旧版也没有、且 DSH 运行时无法承载时才**丢弃**，并写明理由。另有**保留**（判断与形状都不动）与**新增**（DSH 特有、上游没有）。任何一条都不静默消失。

## 唯一蓝本

`reference/codex/models-manager/models.json` 中的 `gpt-6.1-sol.model_messages.instructions_template` 是唯一主蓝本。`gpt-6-astra`、`gpt-6.1-terra` 等只是同代模型变体，不单独充当来源；`models-manager/prompt.md` 是未知模型 fallback，只用于理解旧版兼容路径。

| 上游文件 | 取什么 |
| --- | --- |
| `reference/codex/models-manager/models.json` → `gpt-6.1-sol.model_messages.instructions_template` | 权限与审批、自治与持久、写作风格、技术沟通、commentary/final、visualizations、skills、命令安全 |

`reference/codex/models-manager/prompt.md` 是未知模型的通用 fallback，只作表述参考，不参与 persona 蓝本判断。

## DSH 补丁参考

以下文件只补新版没有覆盖、DSH 又确实需要的旧版工程习惯，是新版缺口的降级来源，不反向成为主基线：

| 上游文件 | 取什么 |
| --- | --- |
| `reference/codex/gpt_5_2_prompt.md` | 计划、执行、交付格式的旧版判断；继续保留在 DSH 专用章节 |
| `reference/codex/gpt-5.2-codex_prompt.md` | 计划工具、review、前端的旧版补充 |
| `reference/codex/gpt_5_codex_prompt.md` | 编辑约束、脏工作树、git 安全 |
| `reference/codex/persistent_mode.md` | 只保留“不自造后续”；persistent async/proactive 部分丢弃 |
| `reference/codex/review/rubric.md` | 什么算值得报告 |

## DSH 工具替换对照

| 上游载体 | DSH 载体 |
| --- | --- |
| `functions.exec` / `exec_command` | `bash`：用 `workdir`、超时与后台任务表达等待和并行 |
| `apply_patch` | `edit` 定点修改、`write` 新建文件 |
| `update_plan` | `todo_write`：一步一个 `in_progress`，完成即标 `completed` |
| `multi_tool_use.parallel` | 同一条消息里并发互不依赖的工具调用 |
| `functions.request_user_input_async` | `ask_user_question` |
| `SKILL.md` / skills 列表 | `skill` 工具与会话技能目录 |
| `commentary` / `final` | 工具调用之间的正文更新 / 最终答复 |
| Apps (Connectors) | 丢弃：DSH 没有等价连接器机制 |
| Plugins | 丢弃：插件由 DSH 运行时管理，persona 不直接调用插件内部工具 |

## 映射表

| 上游内容 | 处理 | 落点与说明 |
| --- | --- | --- |
| 身份声明（GPT-5 in Codex CLI） | 替换 | 开头身份段：DSH + `{{model}}`，并说明 Codex 是 profile 名，不是另一个产品 |
| When to ask the user for permission（授权跨轮、先完成可逆工作、只问用户该决定的事） | 保留 + 替换 | §Permission and approval：提问走 `ask_user_question`，平台审批不重复问 |
| Autonomy and persistence（行动优先、任务不清也推进、compaction 不结束任务） | 保留 | §Autonomy and persistence |
| Personality / Writing style（curious/thoughtful/lucid/warm/candid；plain language、主动语态、避免 AI slop 与 `X, not Y`） | 保留 + 收紧 | §Communicating 与 suffix §Reporting |
| Technical communication（先 outcome 再 reasoning；what/why/test/risk） | 保留 | §Communicating 与 suffix §Reporting |
| Intermediate commentary / Final answer（双通道、60 秒更新、final 自包含） | 保留 + 替换 | §Working in the open 与 suffix §Reporting；commentary 是消息正文，final 是最终答复 |
| Final answer / Formatting rules（outcome-first、自包含、链接格式、无多余总结） | 保留 + 替换 | suffix §Reporting / §Formatting：路径用 DSH 的 `path:line`，不写 `file://` |
| Visualizations（表格、Mermaid、内联图示；简单事实不画图） | 新增 | §Visualizations 与 suffix §Formatting：只在显著提升理解时使用 |
| Writing PR descriptions（问题与最终行为优先） | 新增 | suffix §Reporting 下的 `### Writing PR descriptions` |
| Rules for getting work done（搜索、并发、shell escaping、等待上限、测试纪律） | 保留 + 替换 | §Command safety、§Verifying；`functions.exec` / `exec_command` 换成 `bash`、`workdir`、后台任务 |
| Using skills（何时读、用户指令优先、首次使用播报、审批引用原文） | 新增 | §Using skills：用 `skill` 工具读取完整说明 |
| Apps (Connectors) | 丢弃 | 新版有、旧版和 DSH 都没有等价连接器机制，不能把 Codex 的 `functions.*` 文案搬进来 |
| Plugins | 丢弃 | 新版有、旧版和 DSH 都没有等价的 persona 插件调用机制，插件由 DSH 运行时管理 |
| AGENTS.md 五条细则 | 替换 | 开头第二段一句「指令文件对其作用域有约束力」；细则由 `dsh-agent-instructions` 的 reminder 承担 |
| 默认直接改代码，不交方案 | 保留 | §How to work「Proceed on reversible work」 |
| Planning（`update_plan`、恰好一个 `in_progress`、不重复计划、简单任务不计划） | 替换 | §Planning and execution：改用 `todo_write`；保留判断，并明确要求完成一步立即标 `completed`、最终答复前收尾整个清单；`todo-reminder` 插件负责把完整清单回显给模型并定期提醒 |
| 计划的好/坏示例 | 保留 | §Planning and execution：2 好 2 坏，例改成 DSH 原生写法（指名文件或命令） |
| 并行工具调用（`multi_tool_use.parallel`） | 替换 | §Planning and execution：同一条消息里并发互不依赖的调用 |
| 优先 `rg` / `rg --files` | 替换 + 划边界 | §Searching and reading：grep/glob 工具内置 ripgrep，「比 grep 快」不成立；工具优先，rg 补高级 flag；glob 含 ignored/hidden 而 grep 不含 |
| Editing constraints（ASCII、少注释、无 license、无单字母变量、补丁后不重读） | 保留 | §Editing constraints |
| `apply_patch` FREEFORM | 替换 | §Editing constraints：`edit` 定点改、`write` 建文件，独立编辑并行 |
| 改根因、最小 diff、不修无关 bug、贴合周边风格 | 保留 | §Editing constraints |
| Validating your work（先具体后铺开、无测试的库不加测试、格式化器 ≤3 轮） | 保留 | §Verifying |
| `git log` / `git blame` 取上下文 | 保留 | §How to work |
| 沙箱与审批说明 | 替换 | §Safety + 运行时上下文：提权走 `sandbox_permissions`，只试一次，拒绝是策略结果 |
| dirty worktree / 不 amend / 意外改动停下问 | 保留 | §Safety |
| review 模式与 rubric 八条 | 保留 + 收紧 | suffix §Review：八条压成四条可判定标准（本次引入、值得修、真实影响、不超代码库严格度） |
| 交付格式（Title Case、bullet 数、行号） | 替换 | suffix §Formatting：英文 Title Case、中文短名词短语；行号用 `path:42-58`（DSH 的链接语法） |
| 10 行上限 | 保留 | suffix §Reporting 首段，大改动可放宽为分组 bullet |
| 不重述已写文件、不必提示保存 | 替换 | suffix §Reporting：文件已在磁盘上，引用路径，交付物用 `present` |
| 前端审美（no AI slop、字体、CSS 变量、不用紫白） | 保留但压缩 | suffix §Frontend |
| Proactivity（不结束在「还要不要别的」） | 保留 | suffix 末段：只有真存在下一步时才提 |
| 问时间用 `date` | 丢弃 | `time-context` 已把时间注入运行时上下文 |
| `【F:…†L5-L14】` 引用语法 | 丢弃 | DSH 用 `path:line` 链接 |
| User Updates Spec（动手前说计划、过程中短更新、转向时说明、长任务回报） | 保留 | §Working in the open：近乎逐条对译 User Updates Spec（频率/长度、语气、内容、示例）；唯一本地约束是播报必须与工具调用同一条消息，见增补表 |
| guardian / realtime / compact 等子提示 | 丢弃 | 属 Codex 运行时机制，与编码预设无关 |

## 本地增补

| 增补 | 为什么 |
| --- | --- |
| 提问走 `ask_user_question` | 用散文提问会结束回合，答案要等下一轮才回来 |
| 压缩后重读文件、重跑检查 | 摘要是转述，长任务最容易在这里把旧结论当现状 |
| 沙箱拒绝是策略结果，不是代码缺陷 | 避免把策略拦截误判成被测代码的问题 |
| API 或报错不熟时查当前文档 | 凭记忆重建接口是编码任务最常见的错误 |
| 计划步骤要指名文件或命令 | 上游靠示例传达，这里压成一句可判定的规则 |
| 播报与工具调用写进同一条消息 | 单独发文本会结束回合，用户只看到半句话 |

## 为什么不自动转换

上游文本里的工具名、harness 描述、路径与提权约定都与 Codex 绑定。机械替换会得到互相矛盾的指令（例如同时要求「用 apply_patch」和「用 edit」），所以适配是逐条判断的结果，源码即判断结果本身。

判断的顺序固定为：先保真（判断、示例、语气、形状都留），DSH 有等价物就替换载体，没有等价物就降级到旧 5.x prompt 的对应做法；旧版也没有、且与 DSH 运行时直接冲突时才丢弃，并且必须在上表留下理由。
