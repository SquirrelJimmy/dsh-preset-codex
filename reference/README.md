# reference/

上游 Codex 提示词的原始存档。只用于追溯与再改编：不参与构建，也不进入 npm 包（`package.json` 的 `files` 中没有它）。

- 用 `npm run upstream:check` 查看与上游的差异，`npm run upstream:sync` 拉取并写入；同步的文件清单与上游提交记录在 `reference/upstream.json`。
- 用途：`docs/adaptation.md` 里每条映射都能在这里找到出处。
- 归属：这些文本来自 OpenAI 的 Codex 项目，版权与许可归其原作者。对外分发时请排除本目录，或先确认上游许可。
