import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../plugins/mesosim/scripts/lib/config.mjs';
import { validateRequest, requestApi, prepareSubmission } from '../plugins/mesosim/scripts/lib/api.mjs';
import { parseArgs } from '../plugins/mesosim/scripts/mesosim.mjs';
import { syncVersions } from '../scripts/bump-version.mjs';

const token = 'test-private-token';
const config = { origin: 'https://mesosim.io', token };
const strategy = '{"StrategyName":"Example","Backtest":{"Name":"Run"},"Unknown":9007199254740993,"Decimal":1.2300}';
function capture() {
  const buffers = [];
  const stream = new Writable({ write(chunk, encoding, callback) { buffers.push(Buffer.from(chunk)); callback(); } });
  return { stream, text: () => Buffer.concat(buffers).toString('utf8'), bytes: () => Buffer.concat(buffers) };
}
async function folder(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mesosim plugin test '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function server(t, handle) {
  const http = createServer(handle);
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)); });
  return `http://127.0.0.1:${http.address().port}`;
}

test('dotenv supports Windows BOM/CRLF, comments, quotes, export and literal values', () => {
  assert.deepEqual(parseConfig('\uFEFF# Config\r\n export MESOSIM_INSTANCE="https://mesosim.io/" # retail\r\nMESOSIM_API_KEY=\'literal$KEY=value\'\r\nIGNORED=x\r\n'), { origin: 'https://mesosim.io', token: 'literal$KEY=value' });
  assert.equal(parseConfig('MESOSIM_INSTANCE=http://[::1]:1234\nMESOSIM_API_KEY=x # comment').origin, 'http://[::1]:1234');
});

test('invalid credential files produce credential-free errors', () => {
  for (const origin of ['http://example.com', 'https://user:secret@example.com', 'https://mesosim.io/api', 'https://mesosim.io?x', 'https://mesosim.io#x', 'https://mesosim.io\\evil', 'bad-secret']) {
    assert.throws(() => parseConfig(`MESOSIM_INSTANCE=${origin}\nMESOSIM_API_KEY=${token}`), error => !error.message.includes(token) && !error.message.includes('bad-secret'));
  }
  for (const text of ['', `MESOSIM_INSTANCE=https://mesosim.io\nMESOSIM_API_KEY=${token}\nMESOSIM_API_KEY=duplicate`, 'MESOSIM_INSTANCE=https://mesosim.io\nMESOSIM_API_KEY="unterminated', 'MESOSIM_INSTANCE=https://mesosim.io\nMESOSIM_API_KEY="has space"']) assert.throws(() => parseConfig(text));
});

test('named commands map every documented API operation', () => {
  const cases = [
    [['list'], 'GET', '/api/v1/backtests'],
    [['submit', 'saved request.json'], 'PUT', '/api/v1/backtest/new'],
    ...['status', 'analytics', 'events', 'navs'].map(name => [[name, 'abc'], 'GET', `/api/v1/backtest/abc/${name}`]),
    [['strategy', 'abc'], 'GET', '/api/v1/backtest/abc/strategy-definition'],
    [['external-data', 'abc', '--output', 'data.zip'], 'GET', '/api/v1/backtest/abc/external-data'],
    [['cancel', 'abc'], 'POST', '/api/v1/backtest/abc/cancel'],
    [['sharing', 'abc'], 'GET', '/api/v1/backtest/abc/sharing'],
    [['sharing', 'abc', '--enabled', 'false'], 'POST', '/api/v1/backtest/abc/sharing'],
    [['delete', 'abc', '--mode', 'Details'], 'DELETE', '/api/v1/backtest/abc'],
  ];
  for (const [args, method, path] of cases) {
    const { request } = parseArgs(args);
    assert.equal(request.method, method); assert.equal(request.path, path);
    validateRequest(request);
  }
  assert.deepEqual(parseArgs(['sharing', 'abc', '--enabled', 'true']).request.query, [['sharingEnabled', 'true']]);
  assert.equal(parseArgs(['status', 'id?with#reserved']).request.path, '/api/v1/backtest/id%3Fwith%23reserved/status');
});

test('raw and named requests enforce query/body/delete/ZIP boundaries', () => {
  const invalid = [
    ['DELETE', '/api/v1/backtest/abc'], ['delete', 'abc'],
    ['delete', 'abc', '--mode', 'full'], ['sharing', 'abc', '--enabled', 'yes'],
    ['POST', '/api/v1/backtest/abc/sharing', '--body', 'wrong.json'],
    ['GET', '/api/v1/backtest/%2e%2e/status'], ['GET', '/api/v1/backtest/a%2Fb/status'],
    ['GET', 'https://other.example/api/v1/backtests'], ['GET', '/api/v1/keys'],
    ['GET', '/api/v1/backtests'], ['GET', '/api/v1/backtests', '--query', 'start=2026-01-01'],
    ['GET', '/api/v1/backtests', '--query', 'end=2026-01-01'],
    ['external-data', 'abc'], ['navs', 'abc', '--query', 'view=Analytics'],
    ['list', '--query', 'pageSize=1001'], ['list', '--query', 'page=-1'],
    ['list', '--query', 'page=0', '--query', 'page=1'], ['list', '--query', 'unknown=x'],
    ['list', '--query', 'start=2026-09-08', '--query', 'end=2026-01-01'],
    ['list', '--timeout', 'NaN'], ['list', '--timeout', 'Infinity'], ['list', '--timeout', '0'],
    ['status', 'abc', '--body', 'x.json'], ['status', 'abc', 'extra'],
    ['submit', 'same.json', '--output', 'same.json'], ['setup', '--output', 'file'],
  ];
  for (const args of invalid) assert.throws(() => validateRequest(parseArgs(args).request), `Must reject ${args.join(' ')}`);
});

test('prepare persists a private UUID request and preserves strategy number spellings', async t => {
  const dir = await folder(t);
  const source = join(dir, 'strategy file.json');
  const request = join(dir, 'saved request.json');
  await writeFile(source, '\uFEFF' + strategy);
  const result = await prepareSubmission(source, request);
  const text = await readFile(request, 'utf8');
  assert.ok(text.includes(strategy));
  assert.equal(JSON.parse(text).Shared, false);
  assert.match(result.IdempotencyKey, /^[0-9a-f-]{36}$/);
  await assert.rejects(prepareSubmission(source, request), { code: 'EEXIST' });
  assert.equal(await readFile(request, 'utf8'), text);
});

test('HTTP submission replay sends identical saved bytes and authorization to configured origin', async t => {
  const dir = await folder(t);
  const source = join(dir, 'strategy.json'); const body = join(dir, 'request.json');
  await writeFile(source, strategy); await prepareSubmission(source, body);
  const received = [];
  const origin = await server(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, path: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() });
    res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"BacktestId":"abc","Name":"Run"}');
  });
  const io = { stdout: capture().stream, stderr: capture().stream };
  for (let n = 0; n < 2; n++) assert.equal(await requestApi({ origin, token }, parseArgs(['submit', body]).request, io), 0);
  assert.deepEqual(received[0], received[1]);
  assert.equal(received[0].body, await readFile(body, 'utf8'));
  assert.equal(received[0].authorization, `Bearer ${token}`);
  assert.equal(received[0].path, '/api/v1/backtest/new');
  assert.equal(received[0].method, 'PUT');
});

test('unkeyed submissions fail before network access', async t => {
  const dir = await folder(t); const body = join(dir, 'unkeyed.json');
  await writeFile(body, `{"StrategyDefinition":${strategy},"Shared":false}`);
  await assert.rejects(requestApi(config, parseArgs(['submit', body]).request, { fetchImpl: () => assert.fail('Must not submit') }), /IdempotencyKey/);
});

test('CLI list sends creation-time bounds and preserves explicit filters', async t => {
  const directory = await folder(t);
  const seen = [];
  const record = { Id: 'existing-run', CreatedAt: '2025-01-01T00:00:00Z', Name: 'Existing backtest' };
  const origin = await server(t, (req, res) => {
    const query = new URL(req.url, 'http://localhost').searchParams;
    seen.push(query);
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    // Reflect the API's CreatedAt filter, including its empty range when dates are omitted.
    const start = Date.parse(query.get('start') ?? '0001-01-01');
    const end = Date.parse(query.get('end') ?? '0001-01-01');
    const createdAt = Date.parse(record.CreatedAt);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(createdAt >= start && createdAt <= end ? [record] : []));
  });
  await writeFile(join(directory, '.env.mesosim'), `MESOSIM_INSTANCE=${origin}\nMESOSIM_API_KEY=${token}`);
  const before = Date.now();
  const listed = await cli(['list', '--query', 'page=0', '--query', 'pageSize=20'], directory);
  assert.equal(listed.code, 0);
  assert.deepEqual(JSON.parse(listed.stdout), [record]);
  assert.equal(seen[0].get('start'), '1970-01-01T00:00:00.000Z');
  assert.ok(Date.parse(seen[0].get('end')) >= before && Date.parse(seen[0].get('end')) <= Date.now());
  assert.equal(seen[0].get('page'), '0');
  assert.equal(seen[0].get('pageSize'), '20');
  const explicit = ['start=2024-01-01T00:00:00Z', 'end=2024-12-31T23:59:59Z', 'page=2', 'pageSize=5', 'status=Finished'];
  const filtered = await cli(['list', ...explicit.flatMap(value => ['--query', value])], directory);
  assert.equal(filtered.code, 0);
  assert.deepEqual(JSON.parse(filtered.stdout), []);
  assert.deepEqual([...seen[1]], explicit.map(value => value.split('=')));
});

test('sharing and deletion use query parameters and no body over HTTP', async t => {
  const seen = [];
  const origin = await server(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen.push([req.method, req.url, Buffer.concat(chunks).length]); res.writeHead(204); res.end();
  });
  for (const args of [['sharing', 'abc', '--enabled', 'false'], ['delete', 'abc', '--mode', 'Soft']]) {
    assert.equal(await requestApi({ origin, token }, parseArgs(args).request, { stderr: capture().stream }), 0);
  }
  assert.deepEqual(seen, [['POST', '/api/v1/backtest/abc/sharing?sharingEnabled=false', 0], ['DELETE', '/api/v1/backtest/abc?deleteMode=Soft', 0]]);
});

test('redirects are refused; HTTP errors redact tokens and report Retry-After without retry', async t => {
  let followed = 0; let calls = 0;
  const other = await server(t, (req, res) => { followed++; res.end('unsafe'); });
  const origin = await server(t, (req, res) => {
    calls++; res.writeHead(302, { Location: other, 'Retry-After': '7' }); res.end(`reflected ${token}`);
  });
  const stderr = capture();
  assert.equal(await requestApi({ origin, token }, parseArgs(['list']).request, { stderr: stderr.stream }), 1);
  assert.equal(calls, 1); assert.equal(followed, 0);
  assert.match(stderr.text(), /HTTP 302\nRetry-After: 7/);
  assert.match(stderr.text(), /\[REDACTED\]/); assert.ok(!stderr.text().includes(token));
});

test('binary export preserves bytes and replaces existing file after success', async t => {
  const dir = await folder(t); const output = join(dir, 'data file.zip');
  await writeFile(output, 'old');
  const bytes = Buffer.from([0x50, 0x4b, 0, 255, 128, 10]);
  const origin = await server(t, (req, res) => { res.writeHead(200, { 'Content-Type': 'application/zip' }); res.end(bytes); });
  assert.equal(await requestApi({ origin, token }, parseArgs(['external-data', 'abc', '--output', output]).request, { stderr: capture().stream }), 0);
  assert.deepEqual(await readFile(output), bytes);
  assert.deepEqual(await readdir(dir), ['data file.zip']);
});

test('failed transfer preserves destination and removes temporary partial files', async t => {
  const dir = await folder(t); const output = join(dir, 'nav.csv'); await writeFile(output, 'original');
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); }, pull(controller) { controller.error(new Error('broken')); } });
  await assert.rejects(requestApi(config, parseArgs(['navs', 'abc', '--output', output]).request, { stderr: capture().stream, fetchImpl: async () => new Response(stream) }));
  assert.equal(await readFile(output, 'utf8'), 'original');
  assert.deepEqual(await readdir(dir), ['nav.csv']);
});

test('timeout aborts without retry', async t => {
  let calls = 0;
  const origin = await server(t, () => { calls++; });
  await assert.rejects(requestApi({ origin, token }, parseArgs(['list', '--timeout', '0.1']).request));
  assert.equal(calls, 1);
});

async function cli(args, directory, extraEnv = {}) {
  const script = fileURLToPath(new URL('../plugins/mesosim/scripts/mesosim.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, ...args], { cwd: directory, env: { ...process.env, HOME: directory, USERPROFILE: directory, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; const err = []; child.stdout.on('data', chunk => out.push(chunk)); child.stderr.on('data', chunk => err.push(chunk));
  const [code] = await once(child, 'close');
  return { code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() };
}

test('CLI works outside plugin root, reads only home config and never prints credentials', async t => {
  const dir = await folder(t);
  await writeFile(join(dir, '.env.mesosim'), `MESOSIM_INSTANCE=https://mesosim.io\nMESOSIM_API_KEY=${token}`);
  const result = await cli(['setup'], dir, { MESOSIM_INSTANCE: 'https://wrong.example', MESOSIM_API_KEY: 'wrong-token' });
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout).instance, 'https://mesosim.io');
  assert.ok(!JSON.stringify(result).includes(token));
});

test('CLI docs/help need no API credentials and missing setup explains local action', async t => {
  const dir = await folder(t);
  const docs = await cli(['docs'], dir); assert.equal(docs.code, 0); assert.equal(JSON.parse(docs.stdout).fallback, 'https://docs.mesosim.io');
  assert.equal(JSON.parse(docs.stdout).mcp, null);
  assert.ok(JSON.parse(docs.stdout).libraries.service);
  assert.match(JSON.parse(docs.stdout).instruction, /intro and guidelines/);
  const help = await cli(['--help'], dir); assert.equal(help.code, 0); assert.match(help.stdout, /Deltaray Research Ltd/);
  const setup = await cli(['setup'], dir); assert.equal(setup.code, 2);
  const status = JSON.parse(setup.stdout);
  assert.equal(status.configuration, 'needs_setup');
  assert.equal(status.created, true);
  assert.match(status.instructions, /Never paste the key into chat/);
  const saved = await readFile(join(dir, '.env.mesosim'), 'utf8');
  assert.match(saved, /^MESOSIM_API_KEY=$/m);
  const again = await cli(['setup'], dir);
  assert.equal(JSON.parse(again.stdout).created, false);
  assert.equal(await readFile(join(dir, '.env.mesosim'), 'utf8'), saved);
});

test('CLI setup and docs report the configured FundPro MCP endpoint', async t => {
  const dir = await folder(t);
  await writeFile(join(dir, '.env.mesosim'), `MESOSIM_INSTANCE=https://fund.example\nMESOSIM_API_KEY=${token}`);
  for (const command of ['setup', 'docs']) {
    const result = await cli([command], dir);
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).mcp, 'https://fund.example/mcp/meso-docs');
    assert.ok(!Object.hasOwn(JSON.parse(result.stdout), 'mcpAuth'));
    assert.ok(!JSON.stringify(result).includes(token));
  }
  assert.equal(await readFile(join(dir, '.env.mesosim'), 'utf8'), `MESOSIM_INSTANCE=https://fund.example\nMESOSIM_API_KEY=${token}`);
});

test('release updates both host manifests and rejects drift', async t => {
  const dir = await folder(t);
  const { mkdir } = await import('node:fs/promises');
  const files = ['package.json', 'package-lock.json', 'plugins/mesosim/.claude-plugin/plugin.json', 'plugins/mesosim/.codex-plugin/plugin.json', '.claude-plugin/marketplace.json'];
  for (const file of files) {
    const { dirname } = await import('node:path'); await mkdir(join(dir, dirname(file)), { recursive: true });
    await writeFile(join(dir, file), await readFile(new URL('../' + file, import.meta.url)));
  }
  assert.equal(await syncVersions(dir, '1.2.3', false), '1.2.3');
  await syncVersions(dir, '1.2.3', true);
  await assert.rejects(syncVersions(dir, '1.2.4', true), /mismatch/);
  await assert.rejects(syncVersions(dir, '1.2.3-01', false), /semantic version/);
});
