import { readFile, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { InputError } from './config.mjs';

const manifest = JSON.parse(await readFile(new URL('../../.codex-plugin/plugin.json', import.meta.url), 'utf8'));
export const version = manifest.version;
const resources = ['status', 'analytics', 'strategy-definition', 'events', 'navs', 'external-data', 'sharing'];
const idPattern = '[A-Za-z0-9_~!$&\x27()*+,;=:@%.-]+';

export function validateRequest(request) {
  const { method, path, query = [], body, output, timeout = 60 } = request;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) throw new InputError('Timeout must be between 0 and 3600 seconds.');
  const match = path.match(new RegExp(`^/api/v1/backtest/(${idPattern})(?:/([a-z-]+))?$`));
  if (match) {
    let decoded;
    try { decoded = decodeURIComponent(match[1]); } catch { throw new InputError('Invalid encoded backtest ID.'); }
    if (decoded === '.' || decoded === '..' || /[\/\\\x00-\x1f\x7f]/.test(decoded)) throw new InputError('Invalid backtest ID.');
  }
  const resource = match?.[2];
  const list = method === 'GET' && path === '/api/v1/backtests';
  const submit = method === 'PUT' && path === '/api/v1/backtest/new';
  const valid = list || submit || (match && (
    (method === 'GET' && resources.includes(resource)) ||
    (method === 'POST' && ['cancel', 'sharing'].includes(resource)) ||
    (method === 'DELETE' && !resource)));
  if (!valid) throw new InputError('Unsupported API method/path. Use a documented /api/v1 backtest endpoint.');
  const allowed = list ? ['start', 'end', 'page', 'pageSize', 'includeAnalytics', 'status'] :
    resource === 'events' ? ['start', 'end', 'eventType'] : resource === 'navs' ? ['view'] :
    method === 'POST' && resource === 'sharing' ? ['sharingEnabled'] : method === 'DELETE' ? ['deleteMode'] : [];
  const params = new Map();
  for (const [key, value] of query) {
    if (!allowed.includes(key) || params.has(key)) throw new InputError('Unknown or duplicate query parameter for this endpoint.');
    params.set(key, value);
  }
  if (list && (!params.has('start') || !params.has('end'))) throw new InputError('Listing requires start and end timestamps. Use the list command for defaults, or supply both with --query.');
  if (method === 'DELETE' && !['Soft', 'Details', 'Full'].includes(params.get('deleteMode'))) throw new InputError('Deletion requires explicit deleteMode=Soft, Details, or Full.');
  if (method === 'POST' && resource === 'sharing' && !['true', 'false'].includes(params.get('sharingEnabled'))) throw new InputError('Sharing requires sharingEnabled=true or false.');
  if (params.has('view') && params.get('view') !== 'analytics') throw new InputError('NAV view must be analytics, or omitted for the generic export.');
  if (params.has('status') && !['All', 'Created', 'Started', 'Finished', 'Failed', 'Cancelled'].includes(params.get('status'))) throw new InputError('Invalid list status.');
  if (params.has('includeAnalytics') && !['true', 'false'].includes(params.get('includeAnalytics'))) throw new InputError('includeAnalytics must be true or false.');
  for (const key of ['page', 'pageSize']) {
    if (params.has(key) && (!/^\d+$/.test(params.get(key)) || !Number.isSafeInteger(Number(params.get(key))) || Number(params.get(key)) < (key === 'page' ? 0 : 1) || (key === 'pageSize' && Number(params.get(key)) > 1000))) throw new InputError('page must be nonnegative; pageSize must be 1–1000.');
  }
  for (const key of ['start', 'end']) {
    if (params.has(key) && (!/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(params.get(key)) || !Number.isFinite(Date.parse(params.get(key))))) throw new InputError('Dates must be ISO 8601 timestamps.');
  }
  if (params.has('start') && params.has('end') && Date.parse(params.get('start')) > Date.parse(params.get('end'))) throw new InputError('start must not be after end.');
  if (resource === 'external-data' && !output) throw new InputError('Use --output for the external-data ZIP.');
  if (submit && !body) throw new InputError('Submission requires --body with a saved, keyed request JSON file.');
  if (!submit && body) throw new InputError('This endpoint does not accept a JSON body.');
  if (body && output && resolve(body) === resolve(output)) throw new InputError('Response output must not overwrite the submission file.');
}

export async function readJsonFile(path) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  return { text, value: JSON.parse(text) };
}

export function validateStrategy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.StrategyName !== 'string' || !value.StrategyName.trim() || value.StrategyName.length > 128 ||
      typeof value.Backtest?.Name !== 'string' || !value.Backtest.Name.trim() || value.Backtest.Name.length > 250) {
    throw new InputError('Supply a complete v3 strategy with StrategyName and Backtest.Name. Local checks do not validate the full strategy.');
  }
}

export async function prepareSubmission(strategyPath, output, shared = false) {
  if (!output) throw new InputError('prepare requires --output for the saved submission.');
  const { text, value } = await readJsonFile(strategyPath);
  validateStrategy(value);
  const key = randomUUID();
  // Embed the original JSON: do not round numbers or drop unknown strategy fields.
  const payload = `{\n  "StrategyDefinition": ${text.trim()},\n  "Shared": ${shared},\n  "IdempotencyKey": "${key}"\n}\n`;
  const file = await open(output, 'wx', 0o600);
  try { await file.writeFile(payload); } finally { await file.close(); }
  return { path: resolve(output), IdempotencyKey: key, Shared: shared };
}

export async function requestApi(config, request, { stdout = process.stdout, stderr = process.stderr, fetchImpl = fetch } = {}) {
  validateRequest(request);
  const { method, path, query = [], body, output, timeout = 60 } = request;
  let data;
  if (body) {
    const parsed = await readJsonFile(body);
    validateStrategy(parsed.value?.StrategyDefinition);
    if (typeof parsed.value.IdempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(parsed.value.IdempotencyKey)) throw new InputError('A saved IdempotencyKey is required. Use prepare for an intended new run; reuse the original file for recovery.');
    if (typeof parsed.value.Shared !== 'boolean') throw new InputError('Submission must explicitly set Shared to true or false.');
    data = parsed.text;
  }
  const url = new URL(config.origin + path);
  url.search = new URLSearchParams(query).toString();
  const headers = { Authorization: `Bearer ${config.token}`, 'User-Agent': `MesoSim-AI-Agent-v${version}` };
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetchImpl(url, { method, headers, body: data, redirect: 'manual', signal: AbortSignal.timeout(Math.ceil(timeout * 1000)) });
  const redact = text => text.split(config.token).join('[REDACTED]');
  stderr.write(`HTTP ${response.status}\n`);
  if (response.headers.get('retry-after')) stderr.write(`Retry-After: ${redact(response.headers.get('retry-after'))}\n`);
  if (!response.ok) {
    const chunks = [];
    let size = 0;
    if (response.body) for await (const chunk of response.body) {
      chunks.push(Buffer.from(chunk).subarray(0, 65536 - size));
      size += chunk.length;
      if (size >= 65536) break;
    }
    stderr.write(redact(Buffer.concat(chunks).toString('utf8')) + '\n');
    return 1;
  }
  // Write beside the destination, then rename only after a complete transfer.
  const temporary = output ? `${resolve(output)}.${randomUUID()}.part` : undefined;
  let file;
  try {
    if (temporary) file = await open(temporary, 'wx', 0o600);
    if (response.body) for await (const chunk of response.body) {
      if (file) await file.writeFile(chunk);
      else await new Promise((accept, reject) => stdout.write(Buffer.from(chunk), error => error ? reject(error) : accept()));
    }
    if (file) { await file.close(); file = undefined; await rename(temporary, resolve(output)); }
  } finally {
    if (file) await file.close();
    if (temporary) await unlink(temporary).catch(() => {});
  }
  return 0;
}
