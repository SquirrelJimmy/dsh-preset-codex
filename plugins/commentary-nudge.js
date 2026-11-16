/**
 * Nudge the model after a user-facing root tool batch that ran without a
 * visible progress update.
 *
 * Codex streams updates through a dedicated commentary channel. DSH has only
 * the text the model writes in the same assistant message as its tool calls,
 * and across long runs that text can disappear. A hard pre-execute gate would
 * turn the missing update into a visible tool error; this plugin lets the batch
 * run and attaches a notice to the tool result, so the next assistant message
 * can carry the missing update without a red error row.
 *
 * Short tasks keep the original behavior: one notice per silent batch. Once a
 * turn has gone 60 seconds without a visible update, the plugin repeats the
 * reminder at every completed tool batch until the model writes one. It never
 * interrupts the task.
 *
 * The historical `commentary-nudge` id is kept for preset compatibility.
 */

export const name = 'commentary-nudge';

const MAX_TRACKED_CALLS = 256;
const DEFAULT_INTERVAL_MS = 60_000;
const SKIP_TOOLS = new Set([
  'exit_plan_mode',
  'ask_user_question',
  'compress',
  'wait_agent',
]);

const DEFAULTS = {
  intervalMs: DEFAULT_INTERVAL_MS,
};

/** agent → turn-scoped progress state */
const states = new WeakMap();

function numberOption(config, key) {
  const value = config?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULTS[key];
}

/** session → callId → assistant message event, fed by session/event */
const assistantEvents = new WeakMap();
/** session → latest assistant message that carried a visible pre-tool update */
const visibleMessages = new WeakMap();

function hasVisibleText(parts) {
  return Array.isArray(parts) && parts.some(
    (part) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '',
  );
}

function indexAssistantEvent(session, event) {
  if (session === undefined || session === null) return;
  const content = event?.data?.message?.content;
  if (event?.type !== 'assistant/message' || !Array.isArray(content)) return;

  const firstCall = content.findIndex((part) => part?.type === 'tool-call');
  const visibleText = firstCall === -1
    ? hasVisibleText(content)
    : hasVisibleText(content.slice(0, firstCall));
  if (visibleText && Number.isFinite(event.time)) {
    visibleMessages.set(session, { turn: event.data?.turn, time: event.time });
  }

  const record = {
    seq: event.seq,
    time: event.time,
    data: {
      turn: event.data.turn,
      step: event.data.step,
      message: { content },
    },
  };

  let byCall = assistantEvents.get(session);
  if (byCall === undefined) {
    byCall = new Map();
    assistantEvents.set(session, byCall);
  }

  for (const part of content) {
    if (part?.type === 'tool-call' && typeof part.id === 'string') {
      byCall.set(part.id, record);
    }
  }

  while (byCall.size > MAX_TRACKED_CALLS) {
    byCall.delete(byCall.keys().next().value);
  }
}

function findOwningAssistant(agent, callId) {
  const session = agent.session;
  if (session === undefined) return undefined;
  const byCall = assistantEvents.get(session);
  const event = byCall?.get(callId);
  if (event !== undefined) byCall.delete(callId);
  return event;
}

function hasTextBeforeFirstToolCall(event) {
  const content = event.data?.message?.content;
  if (!Array.isArray(content)) return false;
  const firstCall = content.findIndex((part) => part?.type === 'tool-call');
  if (firstCall === -1) return false;
  return hasVisibleText(content.slice(0, firstCall));
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

function latestVisibleTime(agent, turn) {
  const visible = visibleMessages.get(agent.session);
  if (visible === undefined || !Number.isFinite(visible.time)) return undefined;
  if (turn !== undefined && visible.turn !== undefined && visible.turn !== turn) return undefined;
  return visible.time;
}

function nextState(agent, event, eventTime) {
  const turn = typeof event.data?.turn === 'number' ? event.data.turn : undefined;
  const visibleTime = latestVisibleTime(agent, turn);
  const baseline = visibleTime ?? eventTime;
  let state = states.get(agent);
  if (state === undefined) {
    state = {
      turn,
      lastVisibleAt: baseline,
      lastNoticeAt: baseline,
      batchKey: undefined,
      completedVisibleCalls: new Set(),
      shortNotified: false,
    };
    states.set(agent, state);
    return state;
  }
  if (turn !== undefined && state.turn !== turn) {
    state.turn = turn;
    state.lastVisibleAt = baseline;
    state.lastNoticeAt = baseline;
    state.batchKey = undefined;
    state.completedVisibleCalls = new Set();
    state.shortNotified = false;
  } else if (visibleTime !== undefined && visibleTime > state.lastVisibleAt) {
    state.lastVisibleAt = visibleTime;
    state.lastNoticeAt = visibleTime;
    state.shortNotified = false;
  }
  return state;
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
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

function intervalReminder(elapsed) {
  return {
    role: 'user',
    content: [{
      type: 'text',
      text: `This turn has gone ${formatElapsed(elapsed)} without a visible progress update. In the same assistant message as your next tool calls, write a short progress update in the user's language: 已完成 / 正在做 / 下一步（或阻塞）. Keep it to 1-3 sentences. Do not ask a question unless you are actually blocked.`,
    }],
    source: {
      kind: 'commentary-nudge',
      form: 'notice',
      summary: `progress checkpoint: ${formatElapsed(elapsed)} without update`,
    },
  };
}

function appendNotice(decision, notice) {
  return {
    ...decision,
    additionalContexts: [...(decision.additionalContexts ?? []), notice],
  };
}

export function apply(ctx, config) {
  if (config?.enabled === false) return;

  const now = typeof config?.now === 'function' ? config.now : Date.now;
  const intervalMs = numberOption(config, 'intervalMs');

  ctx.on('session/event', (session, event) => indexAssistantEvent(session, event));

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next();
    try {
      if (exec.agent === undefined) return decision;
      if (exec.parent !== undefined && exec.parent !== null) return decision;
      if (decision.kind === 'block') return decision;

      const event = findOwningAssistant(exec.agent, exec.callId);
      if (event === undefined) return decision;

      const currentTime = now();
      const eventTime = typeof event.time === 'number' && Number.isFinite(event.time)
        ? Math.min(event.time, currentTime)
        : currentTime;
      const state = nextState(exec.agent, event, eventTime);
      const hasVisibleText = hasTextBeforeFirstToolCall(event);
      if (hasVisibleText) {
        state.lastVisibleAt = eventTime;
        state.lastNoticeAt = eventTime;
        state.shortNotified = false;
      }

      const calls = visibleCalls(event);
      const key = batchKey(event);
      if (key === undefined || calls.length === 0) return decision;
      if (!calls.some((call) => call.id === exec.callId)) return decision;

      if (state.batchKey !== key) {
        state.batchKey = key;
        state.completedVisibleCalls = new Set();
      }
      state.completedVisibleCalls.add(exec.callId);
      if (state.completedVisibleCalls.size < calls.length) return decision;

      const silentElapsed = Math.max(0, currentTime - state.lastVisibleAt);
      if (silentElapsed >= intervalMs) {
        const sinceLastNotice = Math.max(0, currentTime - state.lastNoticeAt);
        if (sinceLastNotice < intervalMs) return decision;
        state.lastNoticeAt = currentTime;
        return appendNotice(decision, intervalReminder(silentElapsed));
      }

      if (hasVisibleText) return decision;
      if (state.shortNotified) return decision;
      state.shortNotified = true;
      return appendNotice(decision, reminder());
    } catch {
      return decision;
    }
  });
}
