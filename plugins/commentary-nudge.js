/** Nudge the model on the next step after a silent root tool batch. */

import { randomUUID } from 'node:crypto';

export const name = 'commentary-nudge';

const DEFAULT_INTERVAL_MS = 60_000;
const SKIP_TOOLS = new Set([
  'exit_plan_mode',
  'ask_user_question',
  'compress',
  'wait_agent',
]);

function hasVisibleText(parts) {
  return parts.some(
    (part) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '',
  );
}

function formatElapsed(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
}

function reminder(elapsed) {
  const short = elapsed === undefined;
  const duration = short ? undefined : formatElapsed(elapsed);
  return {
    id: randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: short
        ? 'This tool batch ran without a visible update. In the same assistant message as your next tool calls, write 1-2 sentences in the user\'s language about what you are doing and what comes next. Do not ask a question in the update.'
        : `This turn has gone ${duration} without a visible progress update. In the same assistant message as your next tool calls, give a brief, factual status in the user's language: what is done, what is underway or blocked, or what comes next. Report your current status even if you are still checking or waiting. Do not ask a question in the update.`,
    }],
    source: {
      kind: 'commentary-nudge',
      form: 'notice',
      summary: short ? 'commentary update due' : `progress checkpoint: ${duration} without update`,
    },
  };
}

function turnState(turn, time) {
  return { turn, lastVisibleAt: time, lastCheckpointAt: time, shortNotified: false, batch: undefined };
}

export function apply(ctx, config) {
  if (config?.enabled === false) return;

  const configured = config?.intervalMs;
  const intervalMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_MS;
  const now = typeof config?.now === 'function' ? config.now : Date.now;
  const states = new WeakMap();

  ctx.on('session/event', (session, event) => {
    const { turn, step, message } = event.data ?? {};
    if (!Number.isInteger(turn)) return;
    if (event.type === 'turn/end') {
      if (states.get(session)?.turn === turn) states.delete(session);
      return;
    }
    if (event.type !== 'turn/start' && event.type !== 'assistant/message') return;
    const currentTime = now();
    const time = Number.isFinite(event.time) ? Math.min(event.time, currentTime) : currentTime;
    if (event.type === 'turn/start') {
      states.set(session, turnState(turn, time));
      return;
    }

    const content = message?.content;
    if (!Number.isInteger(step) || !Array.isArray(content)) return;
    let state = states.get(session);
    if (state === undefined) {
      state = turnState(turn, time);
      states.set(session, state);
    }
    if (state.turn !== turn) return;

    const firstCall = content.findIndex((part) => part?.type === 'tool-call');
    const visibleText = hasVisibleText(firstCall === -1 ? content : content.slice(0, firstCall));
    if (visibleText) {
      state.lastVisibleAt = time;
      state.lastCheckpointAt = time;
      state.shortNotified = false;
    }
    const calls = new Set();
    for (const part of content) {
      if (part?.type === 'tool-call' && typeof part.id === 'string' && !SKIP_TOOLS.has(part.name)) {
        calls.add(part.id);
      }
    }
    state.batch = calls.size ? { step, calls, visibleText, successfulAgents: new WeakSet() } : undefined;
  });

  ctx.on('tools/result', (exec, result) => {
    const agent = exec.agent;
    if (!agent || exec.parent != null || result.isError) return;
    const batch = states.get(agent.session)?.batch;
    if (batch?.calls.has(exec.callId)) batch.successfulAgents.add(agent);
  });

  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || signal?.aborted) return decision;
    const state = states.get(agent.session);
    const batch = state?.batch;
    if (state?.turn !== turn || batch === undefined || batch.step + 1 !== step) return decision;
    if (!batch.successfulAgents.delete(agent)) return decision;

    const currentTime = now();
    const elapsed = currentTime - state.lastVisibleAt;
    let notice;
    if (elapsed >= intervalMs && currentTime - state.lastCheckpointAt >= intervalMs) {
      state.lastCheckpointAt = currentTime;
      state.shortNotified = true;
      notice = reminder(elapsed);
    } else if (!batch.visibleText && !state.shortNotified) {
      state.shortNotified = true;
      notice = reminder();
    }
    return notice === undefined ? decision : { ...decision, messages: [...decision.messages, notice] };
  });
}
