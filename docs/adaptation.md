# 与上游 Codex 提示词的对应关系

`reference/` 是上游提示词的原始存档，不参与构建。真正参与构建的是 `src/persona/prefix.md` 与 `src/persona/suffix.md`——它们是逐条判断后的适配结果，不是机械替换的产物。

处理按“新版 → DSH → 旧版”的顺序判断：先看新版蓝本要保留什么；DSH 有等价载体则**替换**，没有等价载体则降级到旧 5.x prompt 的对应做法再适配；旧版也没有、且 DSH 运行时无法承载时才**丢弃**，并写明理由。另有**保留**（判断与形状都不动）与**新增**（DSH 特有、上游没有）。任何一条都不静默消失。

## 唯一蓝本

固定来源是 `https://raw.githubusercontent.com/openai/codex/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/models-manager/models.json`，对应 `rust-v0.170.0`。其中 `gpt-6.2-sol.model_messages.instructions_template` 是唯一主蓝本，且与 `gpt-6.2-astra` 完全相同。`models-manager/prompt.md` 是未知模型 fallback，只用于理解旧版兼容路径。

| 上游文件 | 取什么 |
| --- | --- |
| pinned `codex-rs/models-manager/models.json` → `gpt-6.2-sol.model_messages.instructions_template` | 权限与审批、自治与持久、写作风格、技术沟通、commentary/final、visualizations、skills、命令安全、正常入口与旧输入、失败/重试/并发一致性、交付物检查 |

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
| `functions.request_user_input_async` | `ask_user_question`，沿用 standard 的 legacy 模式，不移植 6.2 的可选等待时间示例 |
| `functions.send_message_to_user_async` | 用工具前正文发进度；无需把 Codex 的异步消息工具暴露给模型 |
| `SKILL.md` / skills 列表 | `skill` 工具与会话技能目录 |
| `commentary` / `final` | 与工具调用同条的正文更新 / 最终答复 |
| Plugins and Apps | 保留按用户指定渠道、权限和会话可用工具办事的原则，改用 DSH 的 skill、MCP 和服务工具；不移植 Codex 的插件标记、连接器命名空间或云运行机制 |

## 映射表

| 上游内容 | 处理 | 落点与说明 |
| --- | --- | --- |
| 身份声明（GPT-5 in Codex CLI） | 替换 | 开头身份段：DSH + `{{model}}`，并说明 Codex 是 profile 名，不是另一个产品 |
| Working with the user（可推断就不问、可选澄清时可按安全假设推进、必答时保持挂起） | 保留 + 替换 | §Permission and approval：保留合并相关问题与多选，先完成不依赖答案的工作，再用 `ask_user_question` 提问；不启用 timed mode，不把跳过、超时或计划批准当作答复 |
| 基线 `# When to ask the user for permission` P4：read-only actions 不需要许可 | 新增本地覆盖 | §Permission and approval / §Searching and reading：只读不等于无边界；大范围读取和隐私敏感目录必须先申请。基线没有该限制，这是本预设的有意安全边界，不是漏抄。 |
| Autonomy and persistence（行动优先、任务不清也推进、compaction 不结束任务） | 保留 | §Autonomy and persistence |
| Personality / Writing style（curious/thoughtful/lucid/warm/candid；plain language、主动语态、避免 AI slop 与 `X, not Y`） | 保留 + 收紧 | §Communicating 与 suffix §Reporting |
| Technical communication（先 outcome 再 reasoning；what/why/test/risk） | 保留 | §Communicating 与 suffix §Reporting |
| Intermediate commentary / Final answer（阶段更新、final 自包含） | 保留 + 替换 | §Working in the open 把 commentary 写进工具前正文；最终答复独立交代实质缺陷、未验路径和未经明确指示作出的假设或决定。60 秒防沉默要求是 DSH 本地补充 |
| Final answer / Formatting rules（outcome-first、自包含、链接格式、无多余总结） | 保留 + 替换 | suffix §Reporting / §Formatting：路径用 DSH 的 `path:line`，不写 `file://` |
| Visualizations（表格、Mermaid、内联图示；简单事实不画图） | 新增 | §Visualizations 与 suffix §Formatting：只在显著提升理解时使用 |
| Writing PR descriptions（问题与最终行为优先） | 沿用本地补充 | 6.2 不再单列该段，suffix 保留已用的 PR 文案约定 |
| Coding Style（正常入口、旧输入、失败/重试/并发一致性、测试取舍和交付物） | 保留 | §Coding style：通过实际入口保持既有行为，按具体回归价值加测试，逐项验收请求的交付，不顺带扩 scope |
| Rules for getting work done（搜索、并发、shell escaping、等待上限、测试纪律） | 保留 + 替换 | §Command safety、§Verifying；`functions.exec` / `exec_command` 换成 `bash`、`workdir`、后台任务 |
| Using skills / Plugins and Apps | 保留 + 替换 | §Using skills and service tools：只使用当前会话开放的技能和服务工具，优先匹配的服务接口，并尊重用户指定的渠道和权限；无等价载体时明确限制 |
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
| User Updates Spec（动手前说计划、过程中短更新、转向时说明、长任务回报） | 保留 + 替换 | §Working in the open：首次调用前简述计划，随后在关键发现、阶段变化和阻塞时短报；短间隔无变化可跳过。旧版「8–10 词」限制与 1–2 句冲突，继续省略；DSH 的同条正文和长静默线见下表 |
| guardian / realtime / compact 等子提示 | 丢弃 | 属 Codex 运行时机制，与编码预设无关 |

## 本地增补

| 增补 | 为什么 |
| --- | --- |
| 提问走 `ask_user_question` | 用散文提问会结束回合，答案要等下一轮才回来；可选澄清先按安全假设推进，必须回答时先做独立工作再直接提问，跳过/超时回答和计划审批不算回答 |
| 压缩后重读文件、重跑检查 | 摘要是转述，长任务最容易在这里把旧结论当现状 |
| 沙箱拒绝是策略结果，不是代码缺陷 | 避免把策略拦截误判成被测代码的问题 |
| API 或报错不熟时查当前文档 | 凭记忆重建接口是编码任务最常见的错误 |
| 计划步骤要指名文件或命令 | 上游靠示例传达，这里压成一句可判定的规则 |
| 播报与工具调用写进同一条消息 | 单独发文本会结束回合，用户只看到半句话 |
| 后台与委派的交付纪律 | DSH 结束当前轮后，后台任务结算或子代理回报仍可能唤醒空闲会话。收尾前收取并验证必要结果，通过可用工具取消本次发起且已无用的工作；取消未确认则明说。主动留待续报时交代未完成项、原因和续报预期，仍依赖待收结果时只交阶段进度。迟到通知只用于兑现续报或纠正重要结论，不重复交付、不自启新任务；不改变 DSH 通知配置。 |
| `todo-reminder` 保留规范清单与下游结果 | 成功 `todo_write` 只在下游没有自定义 `value` 或 `content` 时回显规范化后的完整清单，并保留下游决定；会话投影是恢复来源，`turn/start` 与新的 `todo/write` 按会话重置；达到 `remindEvery` 个符合条件的 accepted `tools/post-execute` 调用后，在下一次 `agent/pre-step` 追加仍未完成的条目 |
| `commentary-nudge` 在续步防沉默 | 用 `assistant/message` 和 `tools/result` 关联真实批次，只要一个非跳过的根调用成功，就能在同一 Agent 获准进入的下一步追加提醒。每段沉默最多一次短提醒；从轮次开始或最近可见正文起达到 60 秒，下一次合格续步提醒模型如实交代现状，即使没有新发现。后续长提醒也至少相隔 60 秒，可用 `intervalMs` 调整，`enabled: false` 可关闭。不唤醒结束的轮次，不设定时器，单次推理或阻塞工具执行中无法插入提醒 |
| 保留用户拥有的决定 | 一次 Jotai 评估里模型两次写「需用户拍板」却没问。影响开始时间、成本、风险、范围或策略例外的选择仍须在写计划前提问；可逆性不把用户的决定降级成假设，也不限制只能提问一次 |
| 计划是决策文档，不是证据堆放 | 一次 Jotai 评估里，计划写了 10,337 字符仍在「先升 3.0.1 还是等 7 天」上替用户拍板；另一侧 Codex 用 2,700 字符先问后写。suffix §Writing plans 要求：仍有用户决定时，第一屏是该决定（选项、推荐、影响）；assumption 只放未能验证的事实；按改动面分组、证据压成一张表、结尾写边界与回滚；不设字数与固定小节名 |
| 大范围读取/隐私目录审批 | 全盘搜索会跨出工作区、挂载盘和其他用户目录，既可能泄露隐私，也造成不必要的资源消耗；本预设用一条本地规则覆盖基线的“只读免批准”，要求先说明根目录、用途和边界并征得同意。 |

## 为什么不自动转换

上游文本里的工具名、harness 描述、路径与提权约定都与 Codex 绑定。机械替换会得到互相矛盾的指令（例如同时要求「用 apply_patch」和「用 edit」），所以适配是逐条判断的结果，源码即判断结果本身。

判断的顺序固定为：先保真（判断、示例、语气、形状都留），DSH 有等价物就替换载体，没有等价物就降级到旧 5.x prompt 的对应做法；旧版也没有、且与 DSH 运行时直接冲突时才丢弃，并且必须在上表留下理由。
