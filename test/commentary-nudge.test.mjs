import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../plugins/commentary-nudge.js';

const enter = { kind: 'enter', messages: [] };
const bash = { type: 'tool-call', id: 'bash', name: 'bash', arguments: { description: 'Work' } };
const text = (value) => ({ type: 'text', text: value });

function fixture(config) {
  let clock = 1_000_000;
  let turn = 1;
  let step = 1;
  const handlers = new Map();
  const agent = { session: {} };
  apply({ on: (event, handler) => handlers.set(event, handler) }, { now: () => clock, ...config });
  function event(type, data, target) {
    handlers.get('session/event')(target.session, { type, data, time: clock });
  }
  return {
    agent,
    events: () => [...handlers.keys()],
    time: (elapsed) => { clock = 1_000_000 + elapsed; },
    start(number = 1, target = agent) {
      turn = number;
      step = 1;
      event('turn/start', { turn }, target);
    },
    end(target = agent) { event('turn/end', { turn }, target); },
    assistant(content = [bash], target = agent) {
      event('assistant/message', { turn, step, message: { role: 'assistant', content } }, target);
    },
    result(call = bash, { error = false, parent, target = agent } = {}) {
      handlers.get('tools/result')({ agent: target, callId: call.id, name: call.name, parent }, { isError: error });
    },
    pre({ decision = enter, signal, target = agent, advance = true } = {}) {
      if (advance) step += 1;
      return handlers.get('agent/pre-step')({ agent: target, turn, step, signal }, async () => decision);
    },
    async batch(content = [bash]) {
      this.assistant(content);
      this.result();
      return this.pre();
    },
  };
}

function notice(decision) {
  return decision.messages.find((message) => message.source?.kind === 'commentary-nudge');
}

test('enabled: false registers no hooks', () => {
  assert.deepEqual(fixture({ enabled: false }).events(), []);
});

test('a silent batch appends once, preserves existing messages and rearms after a new turn', async () => {
  const host = fixture();
  host.start();
  host.assistant();
  host.result();
  host.result();
  const existing = { role: 'user', content: [], source: { kind: 'other' } };
  const decision = { ...enter, messages: [existing] };
  const first = await host.pre({ decision });
  assert.deepEqual(decision.messages, [existing]);
  assert.equal(first.messages[0], existing);
  assert.equal(first.messages.length, 2);
  assert.equal(notice(first).source.summary, 'commentary update due');
  assert.match(notice(first).content[0].text, /user's language/);
  assert.equal(await host.pre({ advance: false }), enter);
  assert.equal(await host.batch(), enter);
  host.end();
  host.start(2);
  assert.ok(notice(await host.batch()));
});

test('mixed success and blocked or early failed calls qualify in either completion order', async () => {
  const failed = { ...bash, id: 'failed' };
  const early = { ...bash, id: 'early' };
  for (const calls of [[bash, failed, early], [early, failed, bash]]) {
    const host = fixture();
    host.start();
    host.assistant([bash, failed, early]);
    for (const call of calls) host.result(call, { error: call !== bash });
    assert.ok(notice(await host.pre()));
  }
});

test('no notice for a skipped, nested, failed, or unowned result', async () => {
  for (const [content, call, options] of [
    [[{ ...bash, name: 'ask_user_question' }], bash, {}],
    [[{ ...bash, name: 'compress' }], bash, {}],
    [[{ ...bash, name: 'exit_plan_mode' }], bash, {}],
    [[{ ...bash, name: 'wait_agent' }], bash, {}],
    [[bash], bash, { parent: { callId: 'ptc' } }],
    [[bash], bash, { error: true }],
    [[bash], { ...bash, id: 'missing' }, {}],
    [[], bash, {}],
  ]) {
    const host = fixture();
    host.start();
    host.assistant(content);
    host.result(call, options);
    assert.equal(await host.pre(), enter);
  }
});

test('results from a different Agent or session cannot trigger the notice', async () => {
  const host = fixture();
  host.start();
  host.assistant();
  host.result(bash, { target: { session: {} } });
  const other = { session: host.agent.session };
  host.result();
  assert.equal(await host.pre({ target: other, advance: false }), enter);
  assert.ok(notice(await host.pre()));
});

test('blocked, aborted, ended and incomplete batches do not inject a notice', async () => {
  const rejected = { kind: 'reject' };
  for (const scenario of ['blocked', 'aborted', 'ended', 'incomplete']) {
    const host = fixture();
    host.start();
    host.assistant();
    host.time(70_000);
    if (scenario !== 'incomplete') host.result();
    if (scenario === 'ended') host.end();
    const options = scenario === 'aborted' ? { signal: AbortSignal.abort() }
      : scenario === 'blocked' ? { decision: rejected } : {};
    assert.equal(await host.pre(options), options.decision ?? enter);
  }
});

test('a success from a different model step is not reused', async () => {
  const host = fixture();
  host.start();
  host.assistant();
  host.result();
  host.time(70_000);
  const rejected = { kind: 'reject' };
  assert.equal(await host.pre({ decision: rejected }), rejected);
  assert.equal(await host.pre(), enter);
});

test('measures silence from turn start and throttles subsequent checkpoints', async () => {
  const host = fixture();
  host.start();
  host.time(58_000);
  assert.equal(notice(await host.batch()).source.summary, 'commentary update due');
  host.time(59_999);
  assert.equal(await host.batch(), enter);
  host.time(60_000);
  const first = notice(await host.batch());
  assert.match(first.source.summary, /^progress checkpoint: 1m/);
  assert.match(first.content[0].text, /still checking or waiting/);
  host.time(119_999);
  assert.equal(await host.batch(), enter);
  host.time(120_000);
  assert.match(notice(await host.batch()).source.summary, /^progress checkpoint: 2m/);
});

test('a visible update resets both clocks and rearms the short notice', async () => {
  const host = fixture();
  host.start();
  host.time(60_000);
  assert.match(notice(await host.batch()).source.summary, /^progress checkpoint:/);
  host.time(80_000);
  assert.equal(await host.batch([text('Checking the next config.'), bash]), enter);
  host.time(90_000);
  assert.equal(notice(await host.batch()).source.summary, 'commentary update due');
  host.time(139_999);
  assert.equal(await host.batch(), enter);
  host.time(140_000);
  assert.match(notice(await host.batch()).source.summary, /^progress checkpoint: 1m/);
});

test('reasoning, whitespace, descriptions and post-call text do not reset the clock', async () => {
  const host = fixture();
  host.start();
  host.time(60_000);
  const result = await host.batch([{ type: 'reasoning', text: 'Thinking' }, text(' \n '), bash, text('After tool')]);
  assert.match(notice(result).source.summary, /^progress checkpoint:/);
});

test('a text-only assistant message also resets the silence baseline', async () => {
  const host = fixture();
  host.start();
  host.time(50_000);
  host.assistant([text('Work is underway.')]);
  assert.equal(await host.pre(), enter);
  host.time(60_000);
  assert.equal(notice(await host.batch()).source.summary, 'commentary update due');
  host.time(110_000);
  assert.match(notice(await host.batch()).source.summary, /^progress checkpoint: 1m/);
});

test('a long tool is evaluated only after it completes and the model enters the next step', async () => {
  const host = fixture({ intervalMs: 10_000 });
  host.start();
  host.assistant([text('Starting a long check.'), bash]);
  host.time(10_000);
  host.result();
  const result = await host.pre();
  assert.match(notice(result).source.summary, /^progress checkpoint: 10s/);
});

test('a first checkpoint consumes the short reminder for that silence', async () => {
  const host = fixture();
  host.start();
  host.time(120_000);
  assert.match(notice(await host.batch()).source.summary, /^progress checkpoint: 2m/);
  host.time(121_000);
  assert.equal(await host.batch(), enter);
});
