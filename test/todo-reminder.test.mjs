import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../plugins/todo-reminder.js';

const todos = [
  { content: 'inspect current state', status: 'completed' },
  { content: 'edit files', status: 'in_progress' },
  { content: 'run verification', status: 'pending' },
];
const accept = { kind: 'accept' };
const enter = { kind: 'enter', messages: [] };

function fixture(remindEvery = 2) {
  const handlers = new Map();
  const projection = new Map();
  const agent = { session: {} };
  apply({
    on: (event, handler) => handlers.set(event, handler),
    sessionProjections: {
      snapshot(session, keys) {
        assert.deepEqual(keys, ['todos']);
        return { values: { todos: projection.get(session) } };
      },
    },
  }, { remindEvery });

  return {
    agent,
    event(type, list, target = agent) {
      projection.set(target.session, list);
      handlers.get('session/event')(target.session, { type });
    },
    restore(list, target = agent) {
      projection.set(target.session, list);
    },
    post(name = 'bash', { target = agent, result = {}, decision = accept } = {}) {
      return handlers.get('tools/post-execute')(
        { name, agent: target, arguments: { todos: [{ content: ' unnormalized input ', status: 'pending' }] } },
        result,
        async () => decision,
      );
    },
    step(target = agent, decision = enter, signal) {
      return handlers.get('agent/pre-step')({ agent: target, signal }, async () => decision);
    },
  };
}

test('todo_write echoes the normalized result and preserves existing contexts', async () => {
  const host = fixture();
  const additionalContexts = [{ role: 'user', content: [] }];
  const result = await host.post('todo_write', {
    result: { isError: false, value: { todos } },
    decision: { kind: 'accept', additionalContexts },
  });
  assert.deepEqual(result.content, [{
    type: 'text',
    text: 'Updated todo list (1/3 completed):\n1. [x] inspect current state\n2. [>] edit files\n3. [ ] run verification',
  }]);
  assert.equal(result.additionalContexts, additionalContexts);
  assert.equal(Object.hasOwn(result, 'value'), false);
});

test('todo_write preserves downstream value, content, blocks and failed or missing results', async () => {
  const host = fixture();
  const result = { isError: false, value: { todos } };
  for (const decision of [
    { kind: 'accept', value: { counts: {} } },
    { kind: 'accept', value: undefined },
    { kind: 'accept', content: [] },
    { kind: 'block', reason: 'blocked' },
  ]) {
    assert.equal(await host.post('todo_write', { result, decision }), decision);
  }
  assert.equal(await host.post('todo_write', { result: { ...result, isError: true } }), accept);
  assert.equal(await host.post('todo_write', { result: { value: { counts: {} } } }), accept);
  const empty = await host.post('todo_write', { result: { value: { todos: [] } } });
  assert.match(empty.content[0].text, /0\/0 completed/);
});

test('restored todos come from the projection, and reminders append once to the next step', async () => {
  const host = fixture();
  host.restore(todos);
  assert.equal(await host.post(), accept);
  assert.equal(await host.step(), enter);
  assert.equal(await host.post('bash', { decision: { kind: 'block' } }).then((result) => result.kind), 'block');
  assert.equal(await host.step(), enter);
  assert.equal(await host.post(), accept);
  await host.post();
  const greeting = { role: 'user', content: [] };
  const decision = { ...enter, messages: [greeting] };
  const result = await host.step(host.agent, decision);
  assert.deepEqual(decision.messages, [greeting]);
  assert.equal(result.messages[0], greeting);
  assert.equal(result.messages.length, 2);
  const reminder = result.messages[1];
  assert.equal(reminder.source.kind, 'todo-reminder');
  assert.match(reminder.content[0].text, /edit files/);
  assert.match(reminder.content[0].text, /run verification/);
  assert.doesNotMatch(reminder.content[0].text, /inspect current state/);
  assert.equal(await host.step(), enter);
});

test('turn start resets only its own session, even when the Agent is reused', async () => {
  const host = fixture();
  const other = { session: {} };
  host.event('todo/write', todos);
  host.event('todo/write', todos, other);
  await host.post();
  await host.post();
  await host.post('bash', { target: other });
  host.event('turn/start', []);
  await host.post();
  host.restore(todos);
  assert.equal(await host.step(), enter);
  await host.post('bash', { target: other });
  assert.equal((await host.step(other)).messages[0].source.kind, 'todo-reminder');
});

test('a later write in the same batch resets the threshold and only its new list is used', async () => {
  const host = fixture();
  host.event('todo/write', todos);
  await host.post();
  await host.post();
  host.event('todo/write', [{ content: 'new item', status: 'in_progress' }]);
  await host.post();
  assert.equal(await host.step(), enter);
  await host.post();
  assert.match((await host.step()).messages[0].content[0].text, /new item/);
  for (const list of [[], [todos[0]]]) {
    await host.post();
    await host.post();
    host.event('todo/write', list);
    await host.post();
    await host.post();
    assert.equal(await host.step(), enter);
  }
});

test('a rejected or cancelled step is unchanged', async () => {
  const host = fixture(1);
  host.restore(todos);
  await host.post();
  const rejected = { kind: 'reject' };
  assert.equal(await host.step(host.agent, rejected), rejected);
  assert.equal(await host.step(host.agent, enter, AbortSignal.abort()), enter);
});
