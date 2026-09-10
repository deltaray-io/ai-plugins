import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { mkdtemp, readFile, stat, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { parseConfig } from '../plugins/mesosim/scripts/lib/config.mjs';
import { instanceFetch, startBridge } from '../plugins/mesosim/scripts/lib/mcp-bridge.mjs';

const secret = 'private-mcp-test-key';
const initialize = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: { roots: { listChanged: true } }, clientInfo: { name: 'plugin-test', version: '1' } } };
const initResult = { protocolVersion: '2025-03-26', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'configured-instance', version: '1' } };
const reply = (res, id, result, headers = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify({ jsonrpc: '2.0', id, result })); };
const event = (res, message) => res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);

async function server(t, handler) {
  const requests = [];
  const http = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const message = body ? JSON.parse(body) : undefined;
    requests.push({ method: req.method, path: req.url, headers: req.headers, message });
    handler(req, res, message);
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  t.after(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)); });
  return { origin: `http://127.0.0.1:${http.address().port}`, requests };
}

async function launch(t, configText) {
  const dir = await mkdtemp(join(tmpdir(), 'mesosim mcp isolated '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Copy ONLY the bundled executable: no repository, package.json or node_modules.
  const script = join(dir, 'mesosim-mcp.mjs');
  await copyFile(new URL('../plugins/mesosim/scripts/mesosim-mcp.mjs', import.meta.url), script);
  if (configText !== undefined) await writeFile(join(dir, '.env.mesosim'), configText);
  const child = spawn(process.execPath, [script], { cwd: dir, env: { ...process.env, HOME: dir, USERPROFILE: dir, MESOSIM_INSTANCE: 'https://must-not-be-used.invalid', MESOSIM_API_KEY: 'must-not-be-used' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  const messages = []; const events = new EventEmitter(); let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    try { messages.push(JSON.parse(line)); } catch { messages.push({ invalidStdout: line }); }
    events.emit('message');
  });
  const wait = async predicate => {
    const signal = AbortSignal.timeout(5000);
    while (!messages.some(predicate)) {
      await once(events, 'message', { signal }).catch(() => { throw new Error(`No expected MCP message. stderr: ${stderr}`); });
    }
    return messages.find(predicate);
  };
  return { dir, child, exited, messages, stderr: () => stderr, send: message => child.stdin.write(JSON.stringify(message) + '\n'), wait };
}

test('configuration contains only the instance and API key', () => {
  const config = `MESOSIM_INSTANCE=https://fund.example\nMESOSIM_API_KEY=${secret}`;
  assert.deepEqual(parseConfig(config), { origin: 'https://fund.example', token: secret });
});

for (const legacySetting of ['', '\nMESOSIM_MCP_AUTH=none']) test(`isolated bundled bridge authenticates all requests${legacySetting ? ' despite a legacy auth setting' : ' without an auth setting'}`, { timeout: 10000 }, async t => {
  const upstream = await server(t, (req, res, msg) => {
    if (req.method === 'GET' || req.method === 'DELETE') { res.writeHead(405); res.end(); return; }
    if (msg.method === 'initialize') reply(res, msg.id, initResult, { 'mcp-session-id': 'session-42' });
    else if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); }
    else if (msg.method === 'tools/list') reply(res, msg.id, { tools: [{ name: 'search_docs', description: 'Instance documentation', inputSchema: { type: 'object' } }] });
    else if (msg.method === 'resources/list') reply(res, msg.id, { resources: [{ uri: 'meso://docs', name: 'Docs' }] });
    else if (msg.method === 'prompts/list') reply(res, msg.id, { prompts: [{ name: 'help' }] });
  });
  const bridge = await launch(t, `\uFEFFMESOSIM_INSTANCE='${upstream.origin}/'\r\nMESOSIM_API_KEY=${secret}\r\n${legacySetting}`);
  bridge.send(initialize);
  assert.deepEqual((await bridge.wait(msg => msg.id === 0)).result, initResult);
  bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  for (const [id, method] of [[1, 'tools/list'], [2, 'resources/list'], [3, 'prompts/list']]) {
    bridge.send({ jsonrpc: '2.0', id, method });
    assert.ok((await bridge.wait(msg => msg.id === id)).result);
  }
  bridge.child.stdin.end();
  assert.equal((await bridge.exited)[0], 0);
  assert.equal(bridge.stderr(), '');
  assert.ok(upstream.requests.some(req => req.method === 'DELETE'));
  assert.ok(upstream.requests.some(req => req.method === 'GET'));
  for (const request of upstream.requests) {
    assert.equal(request.path, '/mcp/meso-docs');
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    if (request.message?.method !== 'initialize') {
      assert.equal(request.headers['mcp-session-id'], 'session-42');
      assert.equal(request.headers['mcp-protocol-version'], '2025-03-26');
    }
  }
  assert.deepEqual(upstream.requests[0].message, initialize);
  assert.ok(!JSON.stringify(bridge.messages).includes(secret));
});

test('streamed notifications, server requests and concurrent cancellation pass through', { timeout: 10000 }, async t => {
  let toolStream;
  const upstream = await server(t, (req, res, msg) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    if (msg.method === 'initialize') reply(res, msg.id, initResult);
    else if (msg.method === 'tools/call') {
      toolStream = res;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      event(res, { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'progress-1', progress: 1, total: 2 } });
      event(res, { jsonrpc: '2.0', id: 'server-request', method: 'roots/list' });
    } else if (msg.method === 'notifications/cancelled') {
      res.writeHead(202); res.end();
      event(toolStream, { jsonrpc: '2.0', id: 7, error: { code: -32800, message: 'Cancelled by user' } });
      toolStream.end();
    } else { res.writeHead(202); res.end(); }
  });
  const bridge = await launch(t, `MESOSIM_INSTANCE=${upstream.origin}\nMESOSIM_API_KEY=${secret}`);
  bridge.send(initialize); await bridge.wait(msg => msg.id === 0);
  bridge.send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'slow', arguments: {}, _meta: { progressToken: 'progress-1' } } });
  await bridge.wait(msg => msg.method === 'notifications/progress');
  await bridge.wait(msg => msg.id === 'server-request');
  const response = { jsonrpc: '2.0', id: 'server-request', result: { roots: [] } };
  bridge.send(response);
  bridge.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } });
  assert.equal((await bridge.wait(msg => msg.id === 7)).error.code, -32800);
  bridge.child.stdin.end(); assert.equal((await bridge.exited)[0], 0);
  assert.ok(upstream.requests.some(req => JSON.stringify(req.message) === JSON.stringify(response)));
});

test('standalone GET event stream forwards server notifications', { timeout: 10000 }, async t => {
  const upstream = await server(t, (req, res, msg) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      event(res, { jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    } else if (msg?.method === 'initialize') reply(res, msg.id, initResult);
    else { res.writeHead(202); res.end(); }
  });
  const bridge = await launch(t, `MESOSIM_INSTANCE=${upstream.origin}\nMESOSIM_API_KEY=${secret}`);
  bridge.send(initialize); await bridge.wait(msg => msg.id === 0);
  bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await bridge.wait(msg => msg.method === 'notifications/tools/list_changed');
  bridge.child.stdin.end(); assert.equal((await bridge.exited)[0], 0);
});

for (const status of [200, 401, 403, 503]) test(`HTTP ${status} HTML produces a concise credential-free failure and no retry`, { timeout: 10000 }, async t => {
  const upstream = await server(t, (req, res) => { res.writeHead(status, { 'content-type': 'text/html', 'retry-after': secret }); res.end(`<html>${secret}${'x'.repeat(50000)}</html>`); });
  const bridge = await launch(t, `MESOSIM_INSTANCE=${upstream.origin}\nMESOSIM_API_KEY=${secret}`);
  bridge.send(initialize);
  const result = await bridge.wait(msg => msg.id === 0);
  assert.ok(result.error); assert.match(result.error.message, /docs.mesosim.io/);
  assert.equal((await bridge.exited)[0], 1);
  assert.equal(upstream.requests.length, 1);
  assert.ok(bridge.stderr().length < 600);
  assert.ok(!bridge.stderr().includes(secret));
  assert.ok(!JSON.stringify(bridge.messages).includes(secret));
  assert.ok(!bridge.stderr().includes('<html>'));
});

test('bearer credentials never follow a redirect', { timeout: 10000 }, async t => {
  const target = await server(t, (req, res) => res.end('must not reach'));
  const upstream = await server(t, (req, res) => { res.writeHead(307, { location: `${target.origin}/mcp/meso-docs` }); res.end(); });
  const bridge = await launch(t, `MESOSIM_INSTANCE=${upstream.origin}\nMESOSIM_API_KEY=${secret}`);
  bridge.send(initialize);
  assert.match((await bridge.wait(msg => msg.id === 0)).error.message, /redirect/);
  await bridge.exited; assert.equal(target.requests.length, 0);
});

test('fetch guard rejects any other endpoint before network access', async () => {
  const guarded = instanceFetch({ origin: 'https://fund.example', token: secret }, { fetchImpl: () => assert.fail('Unexpected request') });
  for (const url of ['https://fund.example/mcp', 'https://other.example/mcp/meso-docs', 'https://fund.example/other', 'https://fund.example/mcp/meso-docs?redirect=x']) await assert.rejects(guarded(url), /outside/);
});

for (const configText of [undefined, `MESOSIM_INSTANCE=invalid\nMESOSIM_API_KEY=${secret}`]) {
  test(`${configText ? 'invalid' : 'missing'} configuration exposes local setup without a startup failure`, { timeout: 10000 }, async t => {
    const bridge = await launch(t, configText);
    bridge.send(initialize);
    const initialized = (await bridge.wait(msg => msg.id === 0)).result;
    assert.equal(initialized.serverInfo.name, 'meso-doc-setup');
    bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    bridge.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.deepEqual((await bridge.wait(msg => msg.id === 1)).result.tools.map(tool => tool.name), ['mesosim_setup']);
    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'mesosim_setup', arguments: {} } });
    const status = JSON.parse((await bridge.wait(msg => msg.id === 2)).result.content[0].text);
    assert.equal(status.configuration, 'needs_setup');
    assert.equal(status.configFile, join(bridge.dir, '.env.mesosim'));
    assert.match(status.instructions, /Never paste the key into chat/);
    const saved = await readFile(status.configFile, 'utf8');
    if (configText) assert.equal(saved, configText, 'Existing invalid configuration must be preserved');
    else {
      assert.match(saved, /^MESOSIM_API_KEY=$/m);
      if (process.platform !== 'win32') assert.equal((await stat(status.configFile)).mode & 0o777, 0o600);
    }
    bridge.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mesosim_setup', arguments: { apiKey: secret } } });
    assert.equal((await bridge.wait(msg => msg.id === 3)).error.code, -32602);
    await writeFile(status.configFile, `MESOSIM_INSTANCE=https://fund.example\nMESOSIM_API_KEY=${secret}`);
    bridge.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mesosim_setup', arguments: {} } });
    const ready = JSON.parse((await bridge.wait(msg => msg.id === 4)).result.content[0].text);
    assert.equal(ready.configuration, 'ready');
    assert.match(ready.instructions, /Reconnect MCP/);
    bridge.child.stdin.end();
    assert.equal((await bridge.exited)[0], 0);
    assert.equal(bridge.stderr(), '');
    assert.ok(!JSON.stringify(bridge.messages).includes(secret));
  });
}

test('initialization deadline closes a stalled response body', { timeout: 3000 }, async () => {
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  stdout.resume(); stderr.resume();
  const bridge = await startBridge({ origin: 'https://fund.example', token: secret }, {
    stdin, stdout, stderr, initializeTimeoutMs: 20,
    fetchImpl: async (url, init) => new Response(new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => controller.error(new Error('aborted'))); } }), { headers: { 'content-type': 'application/json' } }),
  });
  stdin.write(JSON.stringify(initialize) + '\n');
  assert.equal(await bridge.done, 1);
});
