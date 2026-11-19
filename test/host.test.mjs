import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as commentaryNudge from '../plugins/commentary-nudge.js';
import * as todoReminder from '../plugins/todo-reminder.js';

const cliPackage = '@deepseek-ai/dsh';
const cliManifest = `${cliPackage}/package.json`;
const explicitHost = process.env.DSH_INSTALL_ROOT === undefined
  ? 'DSH_INSTALL_DIR'
  : 'DSH_INSTALL_ROOT';
const configuredHost = process.env[explicitHost];

function resolveInstalledHost() {
  if (configuredHost !== undefined) {
    assert.ok(configuredHost.trim(), `${explicitHost} must name a ${cliPackage} package directory`);
    return path.resolve(configuredHost, 'package.json');
  }

  const anchors = [
    import.meta.url,
    path.resolve(path.dirname(process.execPath), '../lib/dsh-test.cjs'),
  ];
  for (const anchor of anchors) {
    try {
      return createRequire(anchor).resolve(cliManifest);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  return undefined;
}

function runInElectron() {
  const electron = process.env.DSH_NODE_EXECUTABLE;
  assert.ok(electron, `${explicitHost} is inside ASAR; set DSH_NODE_EXECUTABLE to the installed Electron executable`);
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(electron, [fileURLToPath(import.meta.url), '--dsh-host-electron'], {
    env, encoding: 'utf8', timeout: 30_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Installed Electron host checks failed:\n${result.stdout}${result.stderr}`);
}

function readHost(manifest) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (cause) {
    throw new Error(`Cannot read ${cliPackage} manifest at ${manifest} (${explicitHost})`, { cause });
  }
  assert.equal(pkg.name, cliPackage, `Unexpected package name in ${manifest}`);
  assert.ok(pkg.version, `Missing DSH version in ${manifest}`);
  return { version: pkg.version, require: createRequire(manifest) };
}

function checkPreset(host) {
  const artifact = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const bundle = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const names = [...new Set([...artifact.matchAll(/^(?: {6}| {12}| {16})name: ['"]?([^'"\s]+)['"]?(?: +#.*)? *$/gm)]
    .map((match) => match[1]))].filter((name) =>
    name !== 'cordis:group' && !name.startsWith(`${bundle.name}/`) && !name.startsWith('.') && !path.isAbsolute(name));
  assert.ok(names.length, 'No host plugin names found in the preset');
  const missing = [];
  for (const name of names) {
    try {
      host.require.resolve(name);
    } catch (error) {
      missing.push(`${name}: ${error.code ?? error.message}`);
    }
  }
  assert.deepEqual(missing, [], `Plugin specifiers unresolved in DSH ${host.version} (${bundle.name})`);
}

function response(parts, reason) {
  return [
    ...parts.flatMap((block, index) => [
      { type: 'block-start', index, blockType: block.type },
      { type: 'block-end', index, block },
    ]),
    { type: 'finish', reason: { kind: reason } },
  ];
}

const text = (value) => ({ type: 'text', text: value });
const toolCall = (id, name, args) => ({ type: 'tool-call', id, name, arguments: JSON.stringify(args) });
const textOf = (parts) => Array.isArray(parts)
  ? parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  : '';

async function exerciseTurn(host, presentation, testContext) {
  const load = (name) => host.require(`@deepseek-ai/${name}`);
  const { Context } = load('cordis');
  const { LlmRuntime, LlmAdapter, createUserMessage } = load('dsh-llm');
  const { SessionStore, SessionId } = load('dsh-session');
  const { SessionProjectionRegistry } = load('dsh-session-projection');
  const { SystemPrompt } = load('dsh-system-prompt');
  const { ToolRuntime, defineTool } = load('dsh-tools');
  const { AgentRegistry } = load('dsh-agent');
  const { AgentLoop } = load('dsh-agent-loop');
  const ptc = presentation === 'ptc';
  const todos = [{ content: 'Closed fixture task', status: 'completed' }, { content: 'Open fixture task', status: 'in_progress' }];
  const probeText = 'Existing queued context';
  const writeProgram = `return await tools.todo_write(${JSON.stringify({ todos })});`;
  const probeProgram = 'await tools.host_probe({ inject: true }); return await tools.host_probe({ inject: false });';
  const programs = new Map([
    [writeProgram, (tools) => tools.todo_write({ todos })],
    [probeProgram, async (tools) => {
      await tools.host_probe({ inject: true });
      return tools.host_probe({ inject: false });
    }],
  ]);
  const runCode = (id, code) => toolCall(id, 'run_code', { code, description: 'Run integration fixture' });
  let clock = Date.now();
  const script = [
    response([
      text('I will track the task and run the probe.'),
      ptc ? runCode('write', writeProgram) : toolCall('write', 'todo_write', { todos }),
    ], 'tool-calls'),
    response(ptc ? [runCode('probe', probeProgram)] : [
      toolCall('probe-first', 'host_probe', { inject: true }),
      toolCall('probe-second', 'host_probe', { inject: false }),
    ], 'tool-calls'),
    response([text('Fixture complete.')], 'stop'),
  ];
  const requests = [];
  class ScriptedAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model };
    }

    async *stream(options) {
      requests.push(options);
      if (requests.length === 2) clock += 61_000;
      const chunks = script[requests.length - 1];
      assert.ok(chunks, 'Unexpected extra model request');
      yield* chunks;
    }
  }

  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  if (ptc) {
    ctx.provide('workingDirectory', { ensure: () => process.cwd() });
    ctx.provide('ptcRuntime', {
      language: 'typescript',
      resolve: (request) => ({ ...request, timeoutMs: 10_000 }),
      async run({ program, bindings }) {
        const execute = programs.get(program);
        assert.ok(execute, `Unexpected PTC fixture program: ${program}`);
        return { logs: [], value: await execute(bindings[0].functions) };
      },
      release: async () => {},
    });
    await ctx.plugin(load('dsh-tool-executor-ptc'), { maxSubCallsPerMinute: 1024 });
  } else {
    await ctx.plugin(load('dsh-tool-executor-native'));
  }
  await ctx.plugin(AgentRegistry);
  const loop = ctx.plugin(AgentLoop, { agents: [] });
  testContext.after(() => loop.dispose());
  await loop;
  await ctx.plugin(load('dsh-tool-todo'), { allowParallelInProgress: false });
  const stepEntries = [];
  const results = [];
  ctx.on('agent/pre-step', async ({ step, messages }, next) => {
    const decision = await next();
    stepEntries.push({ step, input: messages, output: decision.messages });
    return decision;
  });
  ctx.on('tools/result', (exec, result) => results.push({ exec, result }));
  await ctx.plugin(todoReminder, { remindEvery: 2 });
  await ctx.plugin(commentaryNudge, { now: () => clock });
  ctx.tools.register(defineTool({
    name: 'host_probe',
    description: 'Exercise the installed tool invocation pipeline',
    parameters: { inject: { type: 'boolean', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [text(value)] },
    async execute({ inject }, exec) {
      if (inject) exec.agent.inject(createUserMessage({ content: [text(probeText)], source: { kind: 'host-fixture' } }));
      return 'probe succeeded';
    },
  }));
  ctx.llm.registerAdapter(['mock'], new ScriptedAdapter());
  const agent = await ctx.agentLoop.create(SessionId(`codex-host-${presentation}`), { provider: 'mock', model: 'mock' });
  agent.followup(createUserMessage({ content: [text('Run the fixture.')], source: { kind: 'user' } }));
  await agent.whenIdle();

  assert.deepEqual(results.map(({ exec, result }) => [exec.name, exec.parent != null, result.isError]), ptc
    ? [['todo_write', true, false], ['run_code', false, false], ['host_probe', true, false], ['host_probe', true, false], ['run_code', false, false]]
    : [['todo_write', false, false], ['host_probe', false, false], ['host_probe', false, false]]);
  const todoResult = results.find(({ exec }) => exec.name === 'todo_write').result;
  assert.match(textOf(todoResult.content), /\[x\] Closed fixture task\n2\. \[>\] Open fixture task/);
  assert.deepEqual(ctx.sessionProjections.snapshot(agent.session, ['todos']).values.todos, todos);
  const events = agent.session.snapshotEvents();
  const turnEnds = events.filter((event) => event.type === 'turn/end');
  assert.equal(requests.length, 3, `Expected one final model request: ${JSON.stringify(turnEnds.map((event) => event.data))}`);
  assert.deepEqual(stepEntries.map(({ step }) => step), [1, 2, 3]);
  const continuation = stepEntries[2];
  assert.deepEqual(continuation.input.map((message) => message.source.kind), ['host-fixture']);
  assert.deepEqual(continuation.output.map((message) => message.source.kind).sort(), ['commentary-nudge', 'host-fixture', 'todo-reminder']);
  assert.deepEqual(continuation.output[0], continuation.input[0]);
  const noticeText = (kind) => {
    const notice = continuation.output.find((message) => message.source.kind === kind);
    assert.equal(notice.source.form, 'notice');
    return textOf(notice.content);
  };
  assert.match(noticeText('commentary-nudge'), /without a visible progress update/);
  assert.match(noticeText('todo-reminder'), /\[>\] Open fixture task/);
  assert.doesNotMatch(noticeText('todo-reminder'), /Closed fixture task/);
  for (const kind of ['commentary-nudge', 'todo-reminder']) {
    const persisted = events.find((event) => event.type === 'user/message' && event.data.source.kind === kind);
    assert.equal(typeof persisted?.data.id, 'string', `${kind} must persist an identified user message`);
    assert.ok(persisted.data.id.length > 0, `${kind} must persist a nonempty message ID`);
  }
  const modelInput = requests[2].messages.map((message) => textOf(message.content)).join('\n');
  for (const expected of [probeText, noticeText('commentary-nudge'), noticeText('todo-reminder')]) {
    assert.equal(modelInput.split(expected).length - 1, 1, `Expected this text once in the continuation: ${expected}`);
  }
  assert.deepEqual(turnEnds.map((event) => event.data.reason.kind), ['completed']);
}

test('installed DSH host', async (testContext) => {
  const manifest = resolveInstalledHost();
  if (!manifest) return testContext.skip(`Cannot resolve ${cliPackage}`);
  if (!process.versions.electron && /(?:^|[/\\])[^/\\]+\.asar[/\\]/i.test(manifest)) {
    assert.ok(!process.argv.includes('--dsh-host-electron'), 'DSH_NODE_EXECUTABLE did not start Electron');
    runInElectron();
    return;
  }
  const host = readHost(manifest);
  await testContext.test(`preset plugin names resolve in DSH ${host.version}`, () => checkPreset(host));
  for (const presentation of ['raw', 'ptc']) {
    await testContext.test(`${presentation} tool turn preserves continuation notices`, { timeout: 10_000 },
      (turnContext) => exerciseTurn(host, presentation, turnContext));
  }
});
