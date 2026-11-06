import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../plugins/todo-reminder.js';

function context() {
  let handler;
  return {
    on(event, fn) {
      assert.equal(event, 'tools/post-execute');
      handler = fn;
    },
    handler: (...args) => handler(...args),
  };
}

const todos = [
  { content: 'inspect current state', status: 'completed' },
  { content: 'edit files', status: 'in_progress' },
  { content: 'run verification', status: 'pending' },
];

test('todo_write result exposes the full list to the model', async () => {
  const ctx = context();
  apply(ctx, { remindEvery: 2 });
  const result = await ctx.handler(
    { name: 'todo_write', agent: {}, arguments: { todos } },
    { isError: false },
    async () => ({ kind: 'accept', value: { counts: { pending: 1, inProgress: 1, completed: 1 } } }),
  );
  assert.deepEqual(result.content, [{
    type: 'text',
    text: 'Updated todo list (1/3 completed):\n1. [x] inspect current state\n2. [>] edit files\n3. [ ] run verification',
  }]);
});

test('open todos are re-attached every configured number of tool calls', async () => {
  const ctx = context();
  apply(ctx, { remindEvery: 2 });
  const agent = {};
  const next = async () => ({ kind: 'accept', value: {} });

  await ctx.handler(
    { name: 'todo_write', agent, arguments: { todos } },
    { isError: false },
    next,
  );
  const first = await ctx.handler({ name: 'bash', agent, arguments: {} }, { isError: false }, next);
  assert.equal(first.additionalContexts, undefined);
  const second = await ctx.handler({ name: 'bash', agent, arguments: {} }, { isError: false }, next);
  assert.equal(second.additionalContexts.length, 1);
  assert.match(second.additionalContexts[0].content[0].text, /edit files/);
  assert.match(second.additionalContexts[0].content[0].text, /run verification/);
  assert.doesNotMatch(second.additionalContexts[0].content[0].text, /inspect current state/);
});
