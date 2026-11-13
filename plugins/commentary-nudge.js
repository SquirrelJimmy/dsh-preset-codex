/**
 * Nudge the model after a user-facing root tool batch that ran without a
 * visible progress update.
 *
 * Codex streams updates through a dedicated commentary channel. DSH has only
 * the text the model writes in the same assistant message as its tool calls,
 * and across long runs that text can disappear. A hard pre-execute gate would
 * turn the missing update into a visible tool error; this plugin lets the batch
 * run and attaches one notice to the last visible result, so the next assistant
 * message can carry the missing update without a red error row.
 *
 * The historical `commentary-nudge` id is kept for preset compatibility.
 */

export const name = 'commentary-nudge';

const SCAN_EVENTS = 80;
const SKIP_TOOLS = new Set([
  'exit_plan_mode',
  'ask_user_question',
  'compress',
  'wait_agent',
]);

/** agent → { turn, batchKey, completedVisibleCalls, notified } */
const states = new WeakMap();

function findOwningAssistant(agent, callId) {
  const events = agent.session?.snapshotEvents?.();
  if (!Array.isArray(events)) return undefined;
  const from = Math.max(0, events.length - SCAN_EVENTS);
  for (let index = events.length - 1; index >= from; index -= 1) {
    const event = events[index];
    if (event?.type !== 'assistant/message') continue;
    const content = event.data?.message?.content;
    if (!Array.isArray(content)) continue;
    if (!content.some((part) => part?.type === 'tool-call' && part.id === callId)) continue;
    return event;
  }
  return undefined;
}

function hasTextBeforeFirstToolCall(event) {
  const content = event.data?.message?.content;
  if (!Array.isArray(content)) return false;
  const firstCall = content.findIndex((part) => part?.type === 'tool-call');
  if (firstCall === -1) return false;
  return content.slice(0, firstCall).some(
    (part) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '',
  );
}

function visibleCalls(event) {
  const content = event.data?.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part) => part?.type === 'tool-call'
      && typeof part.id === 'string'
      && !SKIP_TOOLS.has(part.name),
  );
}

function batchKey(event) {
  if (event.seq !== undefined) return `seq:${event.seq}`;
  const turn = event.data?.turn;
  const step = event.data?.step;
  if (typeof turn === 'number' && typeof step === 'number') return `${turn}:${step}`;
  return undefined;
}

function nextState(agent, event) {
  const turn = typeof event.data?.turn === 'number' ? event.data.turn : undefined;
  let state = states.get(agent);
  if (state === undefined) {
    state = {
      turn,
      batchKey: undefined,
      completedVisibleCalls: new Set(),
      notified: false,
    };
    states.set(agent, state);
    return state;
  }
  if (turn !== undefined && state.turn !== turn) {
    state.turn = turn;
    state.batchKey = undefined;
    state.completedVisibleCalls = new Set();
    state.notified = false;
  }
  return state;
}

function reminder() {
  return {
    role: 'user',
    content: [{
      type: 'text',
      text: 'This tool batch ran without a visible update before its first tool call. In the same assistant message as your next tool calls, write 1-2 sentences in the user\'s language: what you found and what you will do next. Do not ask a question in the update.',
    }],
    source: {
      kind: 'commentary-nudge',
      form: 'notice',
      summary: 'commentary update due',
    },
  };
}

export function apply(ctx, config) {
  if (config?.enabled === false) return;

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next();
    try {
      if (exec.agent === undefined) return decision;
      if (exec.parent !== undefined && exec.parent !== null) return decision;
      if (decision.kind === 'block') return decision;

      const event = findOwningAssistant(exec.agent, exec.callId);
      if (event === undefined) return decision;

      const state = nextState(exec.agent, event);
      if (hasTextBeforeFirstToolCall(event)) {
        state.notified = false;
        state.completedVisibleCalls.clear();
        return decision;
      }

      const calls = visibleCalls(event);
      const key = batchKey(event);
      if (key === undefined || calls.length === 0) return decision;

      if (state.batchKey !== key) {
        state.batchKey = key;
        state.completedVisibleCalls = new Set();
      }
      if (SKIP_TOOLS.has(exec.name)) return decision;
      state.completedVisibleCalls.add(exec.callId);

      if (state.notified) return decision;
      if (state.completedVisibleCalls.size < calls.length) return decision;

      state.notified = true;
      return {
        ...decision,
        additionalContexts: [...(decision.additionalContexts ?? []), reminder()],
      };
    } catch {
      return decision;
    }
  });
}
