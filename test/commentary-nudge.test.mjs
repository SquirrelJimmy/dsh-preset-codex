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
  return { session: {}, pendingEvents: [...events] };
}

function assistantEvent({
  seq = 1,
  turn = 1,
  step = 1,
  text,
  textAfter = false,
  time = Date.now(),
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
    time,
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

function eventHasCall(event, callId) {
  const content = event?.data?.message?.content;
  return Array.isArray(content) && content.some(
    (part) => part?.type === 'tool-call' && part.id === callId,
  );
}

function run(ctx, exec, next = accept) {
  const pendingEvents = exec.agent?.pendingEvents;
  if (Array.isArray(pendingEvents)) {
    const index = pendingEvents.findIndex((event) => eventHasCall(event, exec.callId));
    if (index !== -1) {
      for (const event of pendingEvents.splice(0, index + 1)) {
        ctx.run('session/event', exec.agent.session, event);
      }
    }
  }
  return ctx.run('tools/post-execute', exec, {}, next);
}

function noticeFor(decision) {
  return decision.additionalContexts?.[0];
}

test('registers the session event feed and the post-execute nudge', () => {
  const ctx = context();
  apply(ctx, {});
  assert.deepEqual(ctx.events(), ['session/event', 'tools/post-execute']);
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
    assistantEvent({ text: 'This should not count.', textAfter: true }),
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
  const first = assistantEvent({ seq: 1, turn: 1, calls: [{ id: 'call-1', name: 'bash' }] });
  const second = assistantEvent({ seq: 2, turn: 1, step: 2, calls: [{ id: 'call-2', name: 'bash' }] });
  const nextTurn = assistantEvent({ seq: 3, turn: 2, step: 1, calls: [{ id: 'call-3', name: 'bash' }] });
  const agent = agentWith([first, second, nextTurn]);

  await run(ctx, execFor({ agent, callId: 'call-1' }));
  const secondResult = await run(ctx, execFor({ agent, callId: 'call-2' }));
  const nextTurnResult = await run(ctx, execFor({ agent, callId: 'call-3' }));

  assert.equal(secondResult.additionalContexts, undefined);
  assert.equal(nextTurnResult.additionalContexts?.length, 1);
});

test('visible text rearms the notice after a silent batch', async () => {
  const ctx = context();
  apply(ctx, {});
  const silent = assistantEvent({ seq: 1, turn: 1, step: 1, calls: [{ id: 'call-1', name: 'bash' }] });
  const visible = assistantEvent({ seq: 2, turn: 1, step: 2, text: 'Progress update.', calls: [{ id: 'call-2', name: 'bash' }] });
  const silentAgain = assistantEvent({ seq: 3, turn: 1, step: 3, calls: [{ id: 'call-3', name: 'bash' }] });
  const agent = agentWith([silent, visible, silentAgain]);

  const first = await run(ctx, execFor({ agent, callId: 'call-1' }));
  const visibleResult = await run(ctx, execFor({ agent, callId: 'call-2' }));
  const last = await run(ctx, execFor({ agent, callId: 'call-3' }));

  assert.equal(first.additionalContexts?.length, 1);
  assert.equal(visibleResult.additionalContexts, undefined);
  assert.equal(last.additionalContexts?.length, 1);
});

test('internal or interactive tools are skipped', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({
      calls: [{ id: 'ask-1', name: 'ask_user_question' }],
    }),
  ]);

  const result = await run(ctx, execFor({ agent, callId: 'ask-1', name: 'ask_user_question' }));
  assert.equal(result.additionalContexts, undefined);
});

test('nested calls are skipped', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([assistantEvent()]);

  const result = await run(ctx, execFor({ agent, parent: { callId: 'parent' } }));
  assert.equal(result.additionalContexts, undefined);
});

test('a mixed batch notices after the last visible call, not after a skipped call', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({
      calls: [
        { id: 'bash-1', name: 'bash' },
        { id: 'compress-1', name: 'compress' },
        { id: 'bash-2', name: 'bash' },
      ],
    }),
  ]);

  const first = await run(ctx, execFor({ agent, callId: 'bash-1' }));
  const skipped = await run(ctx, execFor({ agent, callId: 'compress-1', name: 'compress' }));
  const second = await run(ctx, execFor({ agent, callId: 'bash-2' }));

  assert.equal(first.additionalContexts, undefined);
  assert.equal(skipped.additionalContexts, undefined);
  assert.equal(second.additionalContexts?.length, 1);
});

test('a skipped-only batch does not consume the silence budget', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([
    assistantEvent({
      calls: [{ id: 'wait-1', name: 'wait_agent' }],
    }),
  ]);

  const result = await run(ctx, execFor({ agent, callId: 'wait-1', name: 'wait_agent' }));
  assert.equal(result.additionalContexts, undefined);
});

test('a missing session event does not throw or add a notice', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = { session: {} };

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

test('assistant events are scoped to their session', async () => {
  const ctx = context();
  apply(ctx, {});
  const first = agentWith([]);
  const second = agentWith([]);
  const event = assistantEvent({ calls: [{ id: 'call-1', name: 'bash' }] });
  ctx.run('session/event', first.session, event);

  const result = await run(ctx, execFor({ agent: second, callId: 'call-1' }));
  assert.deepEqual(result, { kind: 'accept' });
});

test('short tasks keep the original one-shot behavior under 60 seconds', async () => {
  let clock = 1_000_000;
  const ctx = context();
  apply(ctx, { now: () => clock });
  const agent = agentWith([
    assistantEvent({ seq: 1, turn: 1, step: 1, time: 1_000_000, calls: [{ id: 'call-1', name: 'bash' }] }),
    assistantEvent({ seq: 2, turn: 1, step: 2, time: 1_000_000, calls: [{ id: 'call-2', name: 'bash' }] }),
  ]);

  const first = await run(ctx, execFor({ agent, callId: 'call-1' }));
  clock = 1_059_000;
  const second = await run(ctx, execFor({ agent, callId: 'call-2' }));

  assert.equal(first.additionalContexts?.length, 1);
  assert.equal(second.additionalContexts, undefined);
});

test('a short notice does not postpone the 60-second checkpoint', async () => {
  let clock = 1_030_000;
  const ctx = context();
  apply(ctx, { now: () => clock });
  const agent = agentWith([
    assistantEvent({ seq: 1, turn: 1, step: 1, time: 1_000_000, calls: [{ id: 'call-1', name: 'bash' }] }),
    assistantEvent({ seq: 2, turn: 1, step: 2, time: 1_030_000, calls: [{ id: 'call-2', name: 'bash' }] }),
  ]);

  const first = await run(ctx, execFor({ agent, callId: 'call-1' }));
  assert.match(noticeFor(first).source.summary, /^commentary update due$/);

  clock = 1_060_000;
  const second = await run(ctx, execFor({ agent, callId: 'call-2' }));
  assert.match(noticeFor(second).source.summary, /^progress checkpoint:/);
});

test('a 60-second silent turn gets a progress checkpoint', async () => {
  let clock = 1_060_000;
  const ctx = context();
  apply(ctx, { now: () => clock });
  const agent = agentWith([
    assistantEvent({ seq: 1, turn: 1, step: 1, time: 1_000_000 }),
  ]);

  const result = await run(ctx, execFor({ agent }));
  const notice = noticeFor(result);
  assert.equal(result.additionalContexts?.length, 1);
  assert.match(notice.source.summary, /^progress checkpoint:/);
  assert.match(notice.content[0].text, /已完成/);
  assert.match(notice.content[0].text, /正在做/);
  assert.match(notice.content[0].text, /下一步/);
});

test('progress checkpoints repeat every 60 seconds without a cap', async () => {
  let clock = 1_060_000;
  const ctx = context();
  apply(ctx, { now: () => clock });
  const events = [];
  for (let index = 1; index <= 4; index += 1) {
    events.push(assistantEvent({
      seq: index,
      turn: 1,
      step: index,
      time: 1_000_000,
      calls: [{ id: `call-${index}`, name: 'bash' }],
    }));
  }
  const agent = agentWith(events);

  const decisions = [];
  decisions.push(await run(ctx, execFor({ agent, callId: 'call-1' })));
  clock = 1_120_000;
  decisions.push(await run(ctx, execFor({ agent, callId: 'call-2' })));
  clock = 1_180_000;
  decisions.push(await run(ctx, execFor({ agent, callId: 'call-3' })));
  clock = 1_240_000;
  decisions.push(await run(ctx, execFor({ agent, callId: 'call-4' })));

  for (const decision of decisions) {
    assert.equal(decision.additionalContexts?.length, 1);
    assert.match(decision.additionalContexts[0].source.summary, /^progress checkpoint:/);
  }
});

test('visible text resets the 60-second window', async () => {
  let clock = 1_100_000;
  const ctx = context();
  apply(ctx, { now: () => clock });
  const agent = agentWith([
    assistantEvent({ seq: 1, turn: 1, step: 1, time: 1_000_000, calls: [{ id: 'call-1', name: 'bash' }] }),
    assistantEvent({ seq: 2, turn: 1, step: 2, time: 1_100_000, text: 'Progress update.', calls: [{ id: 'call-2', name: 'bash' }] }),
    assistantEvent({ seq: 3, turn: 1, step: 3, time: 1_100_000, calls: [{ id: 'call-3', name: 'bash' }] }),
  ]);

  const first = await run(ctx, execFor({ agent, callId: 'call-1' }));
  const visible = await run(ctx, execFor({ agent, callId: 'call-2' }));
  clock = 1_160_000;
  const afterWindow = await run(ctx, execFor({ agent, callId: 'call-3' }));

  assert.equal(first.additionalContexts?.length, 1);
  assert.equal(visible.additionalContexts, undefined);
  assert.equal(afterWindow.additionalContexts?.length, 1);
  assert.match(afterWindow.additionalContexts[0].source.summary, /^progress checkpoint:/);
});

test('a long-running tool is measured from the visible update it followed', async () => {
  let clock = 1_070_000;
  const ctx = context();
  apply(ctx, { now: () => clock });
  const agent = agentWith([
    assistantEvent({ seq: 1, turn: 1, step: 1, time: 1_000_000, text: 'Starting the long check.' }),
  ]);

  const result = await run(ctx, execFor({ agent }));
  assert.equal(result.additionalContexts?.length, 1);
  assert.match(result.additionalContexts[0].source.summary, /^progress checkpoint:/);
});

test('the plugin never cancels the task', async () => {
  let cancelCalls = 0;
  const agent = agentWith([
    assistantEvent({ seq: 1, turn: 1, step: 1, time: 1_000_000 }),
  ]);
  agent.cancel = () => { cancelCalls += 1; throw new Error('must not cancel'); };

  const ctx = context();
  apply(ctx, { now: () => 1_070_000 });

  const result = await run(ctx, execFor({ agent }));
  assert.equal(result.additionalContexts?.length, 1);
  assert.equal(cancelCalls, 0);
});

test('an earlier block decision is returned unchanged', async () => {
  const ctx = context();
  apply(ctx, {});
  const agent = agentWith([assistantEvent()]);

  const result = await run(ctx, execFor({ agent }), async () => ({ kind: 'block' }));
  assert.deepEqual(result, { kind: 'block' });
});

test('enabled: false leaves the plugin inactive', () => {
  const ctx = context();
  apply(ctx, { enabled: false });
  assert.deepEqual(ctx.events(), []);
});

test('a later session event cannot retroactively satisfy an earlier call', async () => {
  const ctx = context();
  apply(ctx, { now: () => 1_002_000 });
  const first = assistantEvent({
    seq: 1,
    turn: 1,
    step: 1,
    time: 1_000_000,
    calls: [{ id: 'call-1', name: 'bash' }],
  });
  const later = assistantEvent({
    seq: 2,
    turn: 1,
    step: 2,
    time: 1_001_000,
    text: 'This text belongs to the later event.',
    calls: [{ id: 'call-1', name: 'bash' }],
  });
  const agent = agentWith([first, later]);

  const result = await run(ctx, execFor({ agent, callId: 'call-1' }));
  assert.equal(result.additionalContexts?.length, 1);
  assert.match(noticeFor(result).source.summary, /^commentary update due$/);
});

test('tracks at most 256 calls per session', async () => {
  const ctx = context();
  apply(ctx, {});
  const calls = Array.from({ length: 257 }, (_, index) => ({
    id: `call-${index}`,
    name: 'bash',
  }));
  const agent = agentWith([
    assistantEvent({
      seq: 1,
      turn: 1,
      step: 1,
      time: 1_000_000,
      calls,
    }),
  ]);

  let result;
  for (const call of calls) {
    result = await run(ctx, execFor({ agent, callId: call.id }));
  }

  assert.equal(result.additionalContexts, undefined);
});

test('a text-only assistant message counts as a visible update', async () => {
  const ctx = context();
  apply(ctx, { now: () => 1_070_000 });
  const progress = assistantEvent({
    seq: 1,
    turn: 1,
    step: 1,
    time: 1_000_000,
    text: 'I found the config; checking the transform next.',
    calls: [],
  });
  const toolBatch = assistantEvent({
    seq: 2,
    turn: 1,
    step: 2,
    time: 1_010_000,
    calls: [{ id: 'call-1', name: 'bash' }],
  });
  const agent = agentWith([progress, toolBatch]);

  const result = await run(ctx, execFor({ agent }));
  assert.match(noticeFor(result).source.summary, /^progress checkpoint:/);
});

test('agents sharing a session keep separate progress state', async () => {
  const ctx = context();
  apply(ctx, {});
  const session = {};
  const first = { session, pendingEvents: [
    assistantEvent({
      seq: 1,
      turn: 1,
      step: 1,
      time: 1_000_000,
      calls: [{ id: 'call-a', name: 'bash' }],
    }),
  ] };
  const second = { session, pendingEvents: [
    assistantEvent({
      seq: 2,
      turn: 1,
      step: 1,
      time: 1_000_000,
      calls: [{ id: 'call-b', name: 'bash' }],
    }),
  ] };

  const firstResult = await run(ctx, execFor({ agent: first, callId: 'call-a' }));
  const secondResult = await run(ctx, execFor({ agent: second, callId: 'call-b' }));

  assert.equal(firstResult.additionalContexts?.length, 1);
  assert.equal(secondResult.additionalContexts?.length, 1);
});
