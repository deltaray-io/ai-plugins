import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, delimiter, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

// Opt-in: requires a Codex CLI with plugin/app-server support. No model calls or
// real account configuration. This exercises Codex's actual plugin path resolver.
for (const configured of [true, false]) test(`Codex installs the plugin and calls a ${configured ? 'documentation' : 'first-time setup'} tool`, { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mesosim native plugin '));
  let child;
  let childExited;
  const pending = new Map();
  const requests = [];
  const startup = [];
  let logs = '';
  const mock = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const message = body ? JSON.parse(body) : null;
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization, message });
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    if (message.id === undefined) { res.writeHead(202); res.end(); return; }
    const results = {
      initialize: { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'mock-meso-doc', version: '1' } },
      'tools/list': { tools: [{ name: 'search_docs', description: 'Search test documentation', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] },
      'tools/call': { content: [{ type: 'text', text: 'Documentation from the configured instance' }], isError: false },
      'resources/list': { resources: [] },
      'resources/templates/list': { resourceTemplates: [] },
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...(results[message.method] ? { result: results[message.method] } : { error: { code: -32601, message: 'Method not found' } }) }));
  });
  t.after(async () => {
    for (const request of pending.values()) request.reject(new Error('Test ended'));
    pending.clear();
    if (child) { child.kill(); await childExited; }
    mock.closeAllConnections();
    await new Promise(resolve => mock.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const origin = `http://127.0.0.1:${mock.address().port}`;
  const marketplacePath = join(directory, '.agents', 'plugins', 'marketplace.json');
  const codexDirectory = join(directory, 'codex');
  await mkdir(dirname(marketplacePath), { recursive: true });
  await mkdir(codexDirectory);
  await cp(new URL('../plugins/mesosim', import.meta.url), join(directory, 'plugins', 'mesosim'), { recursive: true });
  await writeFile(marketplacePath, JSON.stringify({ name: 'meso-native-test', plugins: [{ name: 'mesosim', source: { source: 'local', path: './plugins/mesosim' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }));
  if (configured) await writeFile(join(directory, '.env.mesosim'), `MESOSIM_INSTANCE=${origin}\nMESOSIM_API_KEY=dummy-native-test-key\n`);
  // These are the child process's actual home/config locations, isolated for testing.
  // Do not inherit API keys or the developer's Codex configuration.
  const env = {
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
    HOME: directory, USERPROFILE: directory, CODEX_HOME: codexDirectory,
    TMPDIR: tmpdir(), TEMP: tmpdir(), TMP: tmpdir(), RUST_LOG: 'info',
  };
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
  child = spawn(process.env.MESOSIM_TEST_CODEX ?? 'codex', ['app-server', '--stdio'], { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
  childExited = once(child, 'close');
  child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-100000); });
  createInterface({ input: child.stdout }).on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.method === 'mcpServer/startupStatus/updated') startup.push(message.params);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  let counter = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  await rpc('initialize', { clientInfo: { name: 'meso-native-test', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  await rpc('plugin/install', { marketplacePath, pluginName: 'mesosim' });
  const created = await rpc('thread/start', { cwd: directory, ephemeral: true, model: 'mock', modelProvider: 'mock', config: { 'model_providers.mock': { name: 'mock', base_url: `${origin}/unused-model-api`, wire_api: 'responses', requires_openai_auth: false } } });
  const threadId = created.thread.id;
  const inventory = await rpc('mcpServerStatus/list', { threadId });
  const server = inventory.data.find(item => item.name === 'meso-doc');
  const stderr = logs.split('\n').filter(line => line.includes('MCP server stderr')).join('\n');
  assert.equal(server?.runtimeStatus, 'connected', JSON.stringify({ startup, stderr }));
  if (!configured) {
    assert.equal(server.serverInfo.name, 'meso-doc-setup');
    assert.ok(server.tools.mesosim_setup);
    const called = await rpc('mcpServer/tool/call', { threadId, server: server.name, tool: 'mesosim_setup', arguments: {} });
    assert.match(JSON.stringify(called), /needs_setup/);
    assert.match(JSON.stringify(called), /Never paste the key into chat/);
    assert.match(await readFile(join(directory, '.env.mesosim'), 'utf8'), /^MESOSIM_API_KEY=$/m);
    assert.deepEqual(requests, []);
    assert.ok(!startup.some(event => event.status === 'failed'));
    return;
  }
  assert.equal(server.serverInfo.name, 'mock-meso-doc');
  assert.ok(server.tools.search_docs);
  const called = await rpc('mcpServer/tool/call', { threadId, server: server.name, tool: 'search_docs', arguments: { query: 'entry conditions' } });
  assert.match(JSON.stringify(called), /Documentation from the configured instance/);
  assert.ok(requests.some(request => request.message?.method === 'initialize'));
  assert.ok(requests.some(request => request.message?.method === 'tools/call'));
  for (const request of requests) {
    assert.equal(request.path, '/mcp/meso-docs', 'No model or external endpoint should be called');
    assert.equal(request.authorization, 'Bearer dummy-native-test-key');
  }
});
