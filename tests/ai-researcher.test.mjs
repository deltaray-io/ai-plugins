import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, stat, writeFile, copyFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ensureWorkspace, workspaceReadme } from '../plugins/ai-researcher/scripts/lib/workspace.mjs';
import { setupStatus } from '../plugins/ai-researcher/scripts/lib/config.mjs';
import { instanceFetch } from '../plugins/ai-researcher/scripts/lib/mcp-bridge.mjs';

const secret = 'private-fundpro-test-key';
const initialize = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'researcher-test', version: '1' } } };

async function isolatedHome(t, prefix = 'ai researcher test ') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = directory;
  process.env.USERPROFILE = directory;
  t.after(async () => {
    if (previous.HOME === undefined) delete process.env.HOME; else process.env.HOME = previous.HOME;
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previous.USERPROFILE;
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('workspace setup is private, idempotent, and preserves existing content', async t => {
  const home = await isolatedHome(t);
  const first = await ensureWorkspace();
  assert.equal(first.root, join(home, 'fundpro'));
  assert.equal(first.strategyLibrary, join(home, 'fundpro', 'strategy_library'));
  assert.deepEqual(first.created.sort(), [first.root, first.readme, first.strategyLibrary, first.userCode, first.results, first.research].sort());
  for (const path of [first.root, first.strategyLibrary, first.userCode, first.results, first.research]) {
    assert.ok((await stat(path)).isDirectory());
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o700);
  }
  assert.equal(await readFile(first.readme, 'utf8'), workspaceReadme);
  if (process.platform !== 'win32') assert.equal((await stat(first.readme)).mode & 0o777, 0o600);

  await writeFile(first.readme, '# User notes\n');
  const second = await ensureWorkspace();
  assert.deepEqual(second.created, []);
  assert.equal(await readFile(first.readme, 'utf8'), '# User notes\n');
});

test('workspace setup refuses symlinks and wrong path types', { skip: process.platform === 'win32' }, async t => {
  const home = await isolatedHome(t, 'ai researcher unsafe workspace ');
  const target = join(home, 'target');
  await mkdir(target);
  await symlink(target, join(home, 'fundpro'));
  await assert.rejects(ensureWorkspace(), /must be a directory, not a symlink/);
});

test('workspace setup refuses a redirected research directory', { skip: process.platform === 'win32' }, async t => {
  const home = await isolatedHome(t, 'ai researcher unsafe research ');
  const root = join(home, 'fundpro');
  const target = join(home, 'target');
  await mkdir(root);
  await mkdir(target);
  await symlink(target, join(root, 'research'));
  await assert.rejects(ensureWorkspace(), /research must be a directory, not a symlink/);
});

test('setup reuses MesoSim credentials and reports local readiness', async t => {
  const home = await isolatedHome(t, 'ai researcher configured ');
  await writeFile(join(home, '.env.mesosim'), `MESOSIM_INSTANCE=https://fund.example\nMESOSIM_API_KEY=${secret}`);
  const status = await setupStatus();
  assert.equal(status.configuration, 'ready');
  assert.deepEqual(status.workspace, { configuration: 'ready', root: join(home, 'fundpro') });
  assert.equal('mcp' in status, false);
  assert.equal('apiKeys' in status, false);
  assert.ok(!JSON.stringify(status).includes(secret));
});

test('missing credentials still prepare the workspace and return local-only setup', async t => {
  const home = await isolatedHome(t, 'ai researcher first use ');
  const status = await setupStatus();
  assert.equal(status.configuration, 'needs_setup');
  assert.equal(status.workspace.configuration, 'ready');
  assert.match(status.instructions, /Never paste the key into chat/);
  assert.match(await readFile(join(home, '.env.mesosim'), 'utf8'), /^MESOSIM_API_KEY=$/m);
  assert.equal(await readFile(join(home, 'fundpro', 'README.md'), 'utf8'), workspaceReadme);
});

test('fetch guard sends credentials only to the exact FundPro docs endpoint', async () => {
  const calls = [];
  const guarded = instanceFetch({ origin: 'https://fund.example', token: secret }, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 202 });
  } });
  await guarded('https://fund.example/mcp/fundpro-docs', { method: 'POST' });
  assert.equal(calls[0].url, 'https://fund.example/mcp/fundpro-docs');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), `Bearer ${secret}`);
  assert.equal(calls[0].init.redirect, 'manual');
  for (const url of ['https://fund.example/mcp/meso-docs', 'https://other.example/mcp/fundpro-docs', 'https://fund.example/mcp/fundpro-docs?x=1']) {
    await assert.rejects(guarded(url), /outside/);
  }
  assert.equal(calls.length, 1);
});

test('isolated bundle connects to /mcp/fundpro-docs and creates the workspace', { timeout: 10000 }, async t => {
  const requests = [];
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const message = body ? JSON.parse(body) : undefined;
    requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization, message });
    if (req.method === 'GET' || req.method === 'DELETE') { res.writeHead(405); res.end(); return; }
    if (message.method === 'initialize') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fundpro-docs-test', version: '1' } } }));
    } else { res.writeHead(202); res.end(); }
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });

  const home = await mkdtemp(join(tmpdir(), 'ai researcher bundle '));
  t.after(() => rm(home, { recursive: true, force: true }));
  const script = join(home, 'fundpro-docs-mcp.mjs');
  await copyFile(new URL('../plugins/ai-researcher/scripts/fundpro-docs-mcp.mjs', import.meta.url), script);
  await writeFile(join(home, '.env.mesosim'), `MESOSIM_INSTANCE=http://127.0.0.1:${upstream.address().port}\nMESOSIM_API_KEY=${secret}`);
  const child = spawn(process.execPath, [script], { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const messages = []; const events = new EventEmitter();
  createInterface({ input: child.stdout }).on('line', line => { messages.push(JSON.parse(line)); events.emit('message'); });
  child.stdin.write(JSON.stringify(initialize) + '\n');
  const signal = AbortSignal.timeout(5000);
  while (!messages.some(message => message.id === 0)) await once(events, 'message', { signal });
  assert.equal(messages.find(message => message.id === 0).result.serverInfo.name, 'fundpro-docs-test');
  assert.ok((await stat(join(home, 'fundpro', 'strategy_library'))).isDirectory());
  assert.ok((await stat(join(home, 'fundpro', 'research'))).isDirectory());
  child.stdin.end();
  assert.equal((await exited)[0], 0, stderr);
  assert.ok(requests.some(request => request.message?.method === 'initialize'));
  for (const request of requests) {
    assert.equal(request.path, '/mcp/fundpro-docs');
    assert.equal(request.authorization, `Bearer ${secret}`);
  }
  assert.ok(!JSON.stringify(messages).includes(secret));
  assert.ok(!stderr.includes(secret));
});
