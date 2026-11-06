/**
 * Keep the model's view of the todo list current.
 *
 * The stock todo tool renders only counts after a write, so the model cannot
 * read the list it just wrote. This plugin replaces that result with the full
 * list and periodically re-attaches the open items while work continues.
 */

import { randomUUID } from 'node:crypto';

export const name = 'todo-reminder';

const DEFAULT_REMIND_EVERY = 4;
const STATUS_MARKS = {
  completed: 'x',
  in_progress: '>',
  pending: ' ',
};

const todoLists = new WeakMap();
const callsSinceWrite = new WeakMap();

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

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    const agent = exec.agent;
    if (agent === undefined) return decision;

    if (exec.name === 'todo_write') {
      const todos = exec.arguments?.todos;
      if (decision.kind === 'accept' && !result.isError && Array.isArray(todos)) {
        todoLists.set(agent, todos);
        callsSinceWrite.delete(agent);
        return { ...decision, content: [{ type: 'text', text: renderTodoList(todos) }] };
      }
      return decision;
    }

    const todos = todoLists.get(agent);
    if (todos === undefined || !hasOpenTodos(todos) || decision.kind === 'block') {
      return decision;
    }

    const count = (callsSinceWrite.get(agent) ?? 0) + 1;
    if (count < remindEvery) {
      callsSinceWrite.set(agent, count);
      return decision;
    }

    callsSinceWrite.set(agent, 0);
    const reminder = reminderMessage(todos);
    return {
      ...decision,
      additionalContexts: [...(decision.additionalContexts ?? []), reminder],
    };
  });
}
