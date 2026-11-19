/**
 * Keep the model's view of the todo list current.
 *
 * The stock todo tool renders only counts after a write, so the model cannot
 * read the list it just wrote. This plugin replaces that result with the full
 * list and periodically re-attaches the open items while work continues.
 */

import { randomUUID } from 'node:crypto';

export const name = 'todo-reminder';
export const inject = ['sessionProjections'];

const DEFAULT_REMIND_EVERY = 4;
const STATUS_MARKS = {
  completed: 'x',
  in_progress: '>',
  pending: ' ',
};

function statusMark(status) {
  return STATUS_MARKS[status] ?? ' ';
}

function renderTodoList(todos) {
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const lines = todos.map((todo, index) => {
    const mark = statusMark(todo.status);
    return `${index + 1}. [${mark}] ${todo.content}`;
  });
  return `Updated todo list (${completed}/${todos.length} completed):\n${lines.join('\n')}`;
}

function hasOpenTodos(todos) {
  return todos.some((todo) => todo.status !== 'completed');
}

function reminderMessage(todos) {
  const open = todos.filter((todo) => todo.status !== 'completed');
  const lines = open.map((todo) => `- [${statusMark(todo.status)}] ${todo.content}`);
  return {
    id: randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: `Todo status check:\n${lines.join('\n')}\nUpdate the list with todo_write when the current step finishes.`,
    }],
    source: {
      kind: 'todo-reminder',
      form: 'notice',
      summary: 'todo status check',
    },
  };
}

export function apply(ctx, config) {
  const configured = config?.remindEvery;
  const remindEvery = Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_REMIND_EVERY;

  const callsSinceWrite = new WeakMap();

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'todo/write') callsSinceWrite.delete(session);
  });

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    const session = exec.agent?.session;
    if (session === undefined || decision.kind !== 'accept') return decision;

    if (exec.name === 'todo_write') {
      const todos = result.value?.todos;
      if (result.isError || !Array.isArray(todos)
          || Object.hasOwn(decision, 'value') || Object.hasOwn(decision, 'content')) return decision;
      return { ...decision, content: [{ type: 'text', text: renderTodoList(todos) }] };
    }

    const count = callsSinceWrite.get(session) ?? 0;
    callsSinceWrite.set(session, Math.min(count + 1, remindEvery));
    return decision;
  });

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || signal?.aborted) return decision;
    const session = agent.session;
    if ((callsSinceWrite.get(session) ?? 0) < remindEvery) return decision;

    callsSinceWrite.delete(session);
    const { todos } = ctx.sessionProjections.snapshot(session, ['todos']).values;
    if (!Array.isArray(todos) || !hasOpenTodos(todos)) return decision;
    return { ...decision, messages: [...decision.messages, reminderMessage(todos)] };
  });
}
