# 与上游 Codex 提示词的对应关系

`reference/codex/` 是上游提示词的原始存档（26 个文件）。真正参与构建的是 `src/persona/prefix.md` 与 `src/persona/suffix.md`——它们是逐条判断后的适配结果，不是机械替换的产物。

## 主要取材

| 上游文件 | 用到的部分 |
| --- | --- |
| `gpt_5_2_prompt.md` | 规划纪律、任务执行、交付格式 |
| `gpt-5.2-codex_prompt.md` | 计划工具的使用分寸、review 模式、前端审美 |
| `gpt_5_codex_prompt.md` | 编辑约束、脏工作区规则、git 安全 |
| `persistent_mode.md` | 不要自造后续工作 |
| `review/rubric.md` | 什么算「值得报的缺陷」 |

## 映射表

| 上游内容 | 处理 | 落点 |
| --- | --- | --- |
| 身份声明（based on GPT-5 / Codex CLI） | 改写 | prefix §1：DSH + `{{model}}`，并说明 Codex 是 profile 名 |
| `update_plan` 工具 | 换工具 | `todo_write`；工具描述已写状态机，persona 不重复 |
| `apply_patch` 的 FREEFORM 语法 | 丢弃语法 | 改用 `edit` / `write`，不再教 patch 格式 |
| `multi_tool_use.parallel` | 改写 | 「并行发起互不依赖的调用」 |
| 优先 `rg` / `rg --files` | 保留 + 划边界 | 内置 grep/glob 做常规定位，rg 补 `-A/-B/-C`、`-l`、`-U` 等高级 flag |
| 沙箱与审批说明 | 丢弃 | 运行时上下文按当前模式注入，重复只会打架 |
| AGENTS.md 的优先级说明 | 丢弃 | `dsh-agent-instructions` 自带的 system-reminder 已写明 |
| `git reset --hard` / `git checkout --` | 保留 | 需用户确认；提权走 `sandbox_permissions` 且只试一次 |
| review 模式 | 保留 + 收紧 | suffix §5，叠加 rubric 的取舍标准 |
| 交付格式（Title Case、bullet 数、行号引用） | 保留 | suffix §3 |
| 前端审美 | 保留但压缩 | suffix §6 |
| Proactivity（不要自造后续） | 保留 | suffix §7 |
| User Updates Spec（每步播报） | 丢弃 | DSH 有 todo 展示，逐条播报是噪音 |
| guardian / realtime / compact 等子提示 | 丢弃 | 与编码预设无关，属 Codex 自身运行时机制 |

## 为什么不自动转换

上游文本里的工具名、harness 描述、路径与提权约定都与 Codex 绑定。机械替换会得到互相矛盾的指令（例如同时要求「用 apply_patch」和「用 edit」），所以适配是逐条判断的结果，源码即判断结果本身。
