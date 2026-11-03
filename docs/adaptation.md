# 与上游 Codex 提示词的对应关系

`reference/codex/` 是上游提示词的原始存档，不参与构建。真正参与构建的是 `src/persona/prefix.md` 与 `src/persona/suffix.md`——它们是逐条判断后的适配结果，不是机械替换的产物。

处理方式分四类：**保留**（判断与形状都不动）、**替换**（只换载体，判断留下）、**新增**（DSH 特有、上游没有）、**丢弃**（与 DSH 运行时冲突且无可替代，必须写明理由）。任何一条都不静默消失。

## 主要取材

| 上游文件 | 取什么 |
| --- | --- |
| `gpt_5_2_prompt.md` | 计划、执行、交付格式 |
| `gpt-5.2-codex_prompt.md` | 计划工具、review、前端 |
| `gpt_5_codex_prompt.md` | 编辑约束、脏工作树、git 安全 |
| `persistent_mode.md` | 不自造后续 |
| `review/rubric.md` | 什么算值得报告 |

## 映射表

| 上游内容 | 处理 | 落点与说明 |
| --- | --- | --- |
| 身份声明（GPT-5 in Codex CLI） | 替换 | 开头身份段：DSH + `{{model}}`，并说明 Codex 是 profile 名，不是另一个产品 |
| Personality / Tone（concise, direct, friendly；adapt to the user's style） | 保留 | §Communicating 与 suffix 开头：闲聊、头脑风暴用对话语气 |
| AGENTS.md 五条细则 | 替换 | 开头第二段一句「指令文件对其作用域有约束力」；细则由 `dsh-agent-instructions` 的 reminder 承担 |
| Autonomy and Persistence（做完再交） | 保留 | §How to work「Finish the job inside the turn」 |
| 默认直接改代码，不交方案 | 保留 | §How to work「Proceed on reversible work」 |
| Planning（`update_plan`、恰好一个 `in_progress`、不重复计划、简单任务不计划） | 替换 | §Planning：改用 `todo_write`；状态机在工具描述里已写，这里保留判断 |
| 计划的好/坏示例 | 保留 | §Planning：2 好 2 坏，例改成 DSH 原生写法（指名文件或命令） |
| 并行工具调用（`multi_tool_use.parallel`） | 替换 | §Planning：同一条消息里并发互不依赖的调用 |
| 优先 `rg` / `rg --files` | 替换 + 划边界 | §Searching：grep/glob 工具内置 ripgrep，「比 grep 快」不成立；工具优先，rg 补高级 flag；glob 含 ignored/hidden 而 grep 不含 |
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

判断的顺序固定为：先保真（判断、示例、语气、形状都留），再替换载体，最后才做增补。只有与 DSH 运行时直接冲突、且没有等价物的项才丢弃，并且必须在上表留下理由。
