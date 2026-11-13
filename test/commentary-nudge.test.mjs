import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../plugins/commentary-nudge.js';

const accept = async () => ({ kind: 'accept' });

function context() {
  const handlers = new Map();
  return {
    on(event, handler) {
      assert.equal(handlers.has(event), false, `duplicate handler for ${event}`);
      handlers.set(event, handler);
    },
    events() {
      return [...handlers.keys()];
    },
    run(event, ...args) {
      const handler = handlers.get(event);
      assert.ok(handler, `no handler for ${event}`);
      return handler(...args);
    },
  };
}

function agentWith(events) {
  return { session: { snapshotEvents: () => events } };
}

function assistantEvent({
  seq = 1,
  turn = 1,
  step = 1,
  text,
  textAfter = false,
  calls = [{ id: 'call-1', name: 'bash' }],
} = {}) {
  const content = [];
  if (text !== undefined && !textAfter) content.push({ type: 'text', text });
  for (const call of calls) {
    content.push({ type: 'tool-call', id: call.id, name: call.name, arguments: '{}' });
  }
  if (text !== undefined && textAfter) content.push({ type: 'text', text });
  return {
    seq,
    time: 1,
    type: 'assistant/message',
    data: { turn, step, message: { role: 'assistant', content } },
  };
}

function execFor({ callId = 'call-1', name = 'bash', agent, parent } = {}) {
  return {
    callId,
    rootCallId: callId,
    name,
    arguments: '{}',
    agent,
    parent,
  };
}

function run(ctx, exec, next = accept) {
  return ctx.run('tools/post-execute', exec, {}, next);
}

function noticeFor(decision) {
  return decision.additionalContexts?.[0];
}

test('registers only the post-execute nudge', () => {
  const ctx = context();
  apply(ctx, {});
  assert.deepEqual(ctx.events(), ['tools/post-execute']);
});

test('text before the first tool call does not add a notice', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({ text: 'Found the config; checking the transform next.' }),
  ]);

  const result = await run(ctx, execFor({ agent }));
  assert.deepEqual(result, { kind: 'accept' });
  assert.equal(result.additionalContexts, undefined);
});

test('a text-less batch gets one notice on its last visible call', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({
      calls: [{ id: 'call-1', name: 'bash' }, { id: 'call-2', name: 'bash' }],
    }),
  ]);

  const first = await run(ctx, execFor({ agent, callId: 'call-1' }));
  const second = await run(ctx, execFor({ agent, callId: 'call-2' }));
  assert.equal(first.additionalContexts, undefined);
  assert.equal(second.additionalContexts?.length, 1);

  const notice = noticeFor(second);
  assert.equal(notice.role, 'user');
  assert.equal(notice.source.kind, 'commentary-nudge');
  assert.equal(notice.source.form, 'notice');
  assert.match(notice.content[0].text, /1-2 sentences/);
  assert.match(notice.content[0].text, /same assistant message/);
  assert.match(notice.content[0].text, /user's language/);
});

test('text after the first tool call still counts as missing', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({ text: 'Found it after the call.', textAfter: true }),
  ]);

  const result = await run(ctx, execFor({ agent }));
  assert.equal(result.additionalContexts?.length, 1);
});

test('whitespace is not a visible update', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([assistantEvent({ text: '   \n\t' })]);

  const result = await run(ctx, execFor({ agent }));
  assert.equal(result.additionalContexts?.length, 1);
});

test('one notice per silence, and a new turn rearms it', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({ seq: 1, turn: 1, step: 1, calls: [{ id: 'call-1', name: 'bash' }] }),
    assistantEvent({ seq: 2, turn: 1, step: 2, calls: [{ id: 'call-2', name: 'bash' }] }),
    assistantEvent({ seq: 3, turn: 2, step: 1, calls: [{ id: 'call-3', name: 'bash' }] }),
  ]);

  const first = await run(ctx, execFor({ agent, callId: 'call-1' }));
  const second = await run(ctx, execFor({ agent, callId: 'call-2' }));
  const third = await run(ctx, execFor({ agent, callId: 'call-3' }));
  assert.equal(first.additionalContexts?.length, 1);
  assert.equal(second.additionalContexts, undefined);
  assert.equal(third.additionalContexts?.length, 1);
});

test('visible text rearms the notice after a silent batch', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({ seq: 1, turn: 1, step: 1, calls: [{ id: 'call-1', name: 'bash' }] }),
    assistantEvent({
      seq: 2,
      turn: 1,
      step: 2,
      text: 'Checked the transform; running the focused test next.',
      calls: [{ id: 'call-2', name: 'bash' }],
    }),
    assistantEvent({ seq: 3, turn: 1, step: 3, calls: [{ id: 'call-3', name: 'bash' }] }),
  ]);

  const first = await run(ctx, execFor({ agent, callId: 'call-1' }));
  const second = await run(ctx, execFor({ agent, callId: 'call-2' }));
  const third = await run(ctx, execFor({ agent, callId: 'call-3' }));
  assert.equal(first.additionalContexts?.length, 1);
  assert.equal(second.additionalContexts, undefined);
  assert.equal(third.additionalContexts?.length, 1);
});

test('internal or interactive tools are skipped', async () => {
  const ctx = context();
  apply(ctx, {});
  const calls = [
    { id: 'call-plan', name: 'exit_plan_mode' },
    { id: 'call-ask', name: 'ask_user_question' },
    { id: 'call-compress', name: 'compress' },
    { id: 'call-wait', name: 'wait_agent' },
  ];
  const agent = agentWith([assistantEvent({ calls })]);

  for (const call of calls) {
    const result = await run(ctx, execFor({
      agent,
      callId: call.id,
      name: call.name,
    }));
    assert.equal(result.additionalContexts, undefined);
  }
});

test('nested calls are skipped', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([assistantEvent()]);

  const result = await run(ctx, execFor({ agent, parent: {} }));
  assert.equal(result.additionalContexts, undefined);
});

test('a mixed batch notices after the last visible call, not after a skipped call', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({
      calls: [
        { id: 'call-compress', name: 'compress' },
        { id: 'call-bash', name: 'bash' },
      ],
    }),
  ]);

  const skipped = await run(ctx, execFor({
    agent,
    callId: 'call-compress',
    name: 'compress',
  }));
  const visible = await run(ctx, execFor({
    agent,
    callId: 'call-bash',
    name: 'bash',
  }));
  assert.equal(skipped.additionalContexts, undefined);
  assert.equal(visible.additionalContexts?.length, 1);
});

test('a skipped-only batch does not consume the silence budget', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({
      seq: 1,
      turn: 1,
      step: 1,
      calls: [{ id: 'call-compress', name: 'compress' }],
    }),
    assistantEvent({
      seq: 2,
      turn: 1,
      step: 2,
      calls: [{ id: 'call-bash', name: 'bash' }],
    }),
  ]);

  const skipped = await run(ctx, execFor({
    agent,
    callId: 'call-compress',
    name: 'compress',
  }));
  const visible = await run(ctx, execFor({
    agent,
    callId: 'call-bash',
    name: 'bash',
  }));
  assert.equal(skipped.additionalContexts, undefined);
  assert.equal(visible.additionalContexts?.length, 1);
});

test('a broken session read does not throw or add a notice', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = {
    session: {
      snapshotEvents() {
        throw new Error('session is gone');
      },
    },
  };

  const result = await run(ctx, execFor({ agent }));
  assert.deepEqual(result, { kind: 'accept' });
});

test('a call without an owning assistant message does not add a notice', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([]);

  const result = await run(ctx, execFor({ agent }));
  assert.deepEqual(result, { kind: 'accept' });
});

test('an earlier block decision is returned unchanged', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([assistantEvent()]);
  const policy = { kind: 'block', reason: 'blocked by policy' };

  const result = await run(ctx, execFor({ agent }), async () => policy);
  assert.equal(result, policy);
});

test('enabled: false leaves the plugin inactive', () => {
  const ctx = context();
  apply(ctx, { enabled: false });
  assert.deepEqual(ctx.events(), []);
});
