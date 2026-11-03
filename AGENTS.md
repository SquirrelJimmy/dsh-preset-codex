# 维护准则

本文件对本仓库生效。这是一个 DSH bundle：把 Codex 的提示词适配成 Agent 预设，产物是一份 loader patch。

## 铁律

1. **不手改 `cordis.patch.yml`**。它是构建产物，改完 `src/` 后跑 `node scripts/build.mjs` 覆盖。
2. **提示词只改 `src/persona/prefix.md` 与 `src/persona/suffix.md`**。模板里那两个块标量是注入结果，改它们等于改产物。
3. **保持零依赖**。`scripts/build.mjs` 只用 node 内置模块，不解析 YAML、不引第三方库——这是产物可逐字节复现的前提。
4. **`reference/` 是只读存档**。不参与构建、不进 npm 包，也不要把上游原文整段粘进 persona：既有版权问题，也会白白撑大每次请求的上下文。
5. **插件行是 `standard` 预设的快照**。dsh 升级后对比 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`，把新增或改名的行同步进 `src/preset.template.yml`。
6. **manifest 契约别拆**。`dsh.manifestVersion: 1`、`dsh.bundle.patch`、`exports` 里的 `./package.json`、`./icon`、`./locale/*.json` 是 dsh 读元数据的入口，`npm test` 会检查。

## 常见改动

| 想改什么 | 动哪里 |
| --- | --- |
| 人格、工作方式、交付格式 | `src/persona/{prefix,suffix}.md` → 构建 |
| 挂哪些工具、工具参数 | `src/preset.template.yml` 的 `plugins` 列表 |
| 预设卡片文案（不随界面语言切换） | `src/preset.template.yml` 的 `config.description` → 构建，同步 `locale/zh.json` 与 `package.json` |
| 插件卡片文案（随界面语言切换） | `locale/*.json` 的 `meta` |
| 图标 | `icon.svg`（≤256 KiB） |
| 发版 | `package.json` 的 `version` 递增，`npm test` 与 `npm pack --dry-run` 通过 |

插件列表刻意与 `standard` 保持同构，只差三处：`persona` 换成 Codex 文本、`tool-todo` 串行化、去掉 `tool-plugin-manager` 与 `tool-plugin-market`。新增差异前先想清楚是否真的需要——每多一处偏离，升级时都要多修一处。

## 提交前校验

```bash
node scripts/build.mjs --check    # 产物与源码一致
npm test                          # 产物新鲜度、预设行、文案一致性、manifest 契约
npm pack --dry-run                # 产物应只有 7 个文件（含自动附带的 LICENSE）
```

若默认缓存目录不可写导致 `npm` 报 EACCES，给 `--cache` 指一个可写目录即可。

## 约束

- **bundle 的 patch 只在启动时合成**，改完 YAML 需要重启 dsh，不享受 profile patch 的热加载。安装或卸载会改写 `dsh.profile.bundles`，但这不触发 bundle 层重新合成：实测装完不重启时，预设注册表里仍看不到新预设。
- **Web 端没有预设编辑器**。设置页的预设列表是只读的，创建或覆盖预设走「创造模式」生成新的 bundle；改本预设只能改本仓库源码再重启。
- **默认预设仍是 `standard`**，本预设不抢默认，由用户选择。
- **persona 有词数预算**（2000 词，`npm test` 会卡）。新增一条规则前先想清楚删哪条；上游的好点优先保留，不适用的载体做替换，不要静默丢弃。
