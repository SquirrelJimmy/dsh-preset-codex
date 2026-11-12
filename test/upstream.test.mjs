import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, selectTrackedFiles } from '../scripts/sync-upstream.mjs';

test('上游文件按路径映射到本地归档', () => {
  const files = selectTrackedFiles([
    'codex-rs/core/gpt_5_2_prompt.md',
    'codex-rs/core/gpt-5.2-codex_prompt.md',
    'codex-rs/prompts/templates/compact/prompt.md',
    'codex-rs/prompts/templates/review/exit_success.xml',
    'codex-rs/models-manager/prompt.md',
    'codex-rs/models-manager/models.json',
    'codex-rs/protocol/src/prompts/base_instructions/default.md',
    'codex-rs/core/templates/collab/experimental_prompt.md',
    'README.md',
  ]);

  assert.equal(files.length, 7);
  assert.deepEqual(
    files.map((file) => [file.upstream, file.local]),
    [
      ['codex-rs/protocol/src/prompts/base_instructions/default.md', 'reference/codex/base_instructions/default.md'],
      ['codex-rs/prompts/templates/compact/prompt.md', 'reference/codex/compact/prompt.md'],
      ['codex-rs/core/gpt-5.2-codex_prompt.md', 'reference/codex/gpt-5.2-codex_prompt.md'],
      ['codex-rs/core/gpt_5_2_prompt.md', 'reference/codex/gpt_5_2_prompt.md'],
      ['codex-rs/models-manager/models.json', 'reference/codex/models-manager/models.json'],
      ['codex-rs/models-manager/prompt.md', 'reference/codex/models-manager/prompt.md'],
      ['codex-rs/prompts/templates/review/exit_success.xml', 'reference/codex/review/exit_success.xml'],
    ],
  );
});

test('拒绝越界归档路径', () => {
  assert.throws(
    () => selectTrackedFiles(['codex-rs/prompts/templates/../escape.md']),
    /拒绝写入非法归档路径/,
  );
});

test('命令行默认只检查，--write 才写入', () => {
  assert.deepEqual(parseArgs([]), {
    write: false,
    prune: false,
    ref: 'main',
    json: false,
    help: false,
  });
  assert.equal(parseArgs(['--write']).write, true);
  assert.equal(parseArgs(['--ref', '6bfdc75']).ref, '6bfdc75');
  assert.throws(() => parseArgs(['--prune']), /--prune 只能与 --write/);
});
