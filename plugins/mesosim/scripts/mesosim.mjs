#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { InputError, loadConfig, setupStatus } from './lib/config.mjs';
import { prepareSubmission, requestApi, version } from './lib/api.mjs';

export const help = `MesoSim ${version} — Deltaray Research Ltd. — https://mesosim.io

Usage: node <plugin-root>/scripts/mesosim.mjs <command> [arguments]

  setup                                    Prepare/check local configuration; no network request
  docs                                     Show documentation MCP and web fallback URLs
  list [--query KEY=VALUE ...]              GET /api/v1/backtests
  prepare STRATEGY.json --output REQUEST.json [--shared true|false]
                                           Save a new keyed request; no network request
  submit REQUEST.json                      PUT /api/v1/backtest/new
  status ID                                GET /api/v1/backtest/{id}/status
  cancel ID                                POST /api/v1/backtest/{id}/cancel
  analytics ID                             GET /api/v1/backtest/{id}/analytics
  strategy ID                              GET /api/v1/backtest/{id}/strategy-definition
  events ID [--query KEY=VALUE ...]         GET /api/v1/backtest/{id}/events
  navs ID [--query view=analytics]           GET /api/v1/backtest/{id}/navs
  external-data ID --output DATA.zip        GET /api/v1/backtest/{id}/external-data
  sharing ID [--enabled true|false]         GET/POST /api/v1/backtest/{id}/sharing
  delete ID --mode Soft|Details|Full        DELETE /api/v1/backtest/{id}
  GET|PUT|POST|DELETE /api/v1/...            Raw documented endpoint access

Request options: --query KEY=VALUE (repeatable), --output FILE, --timeout SECONDS (default 60)
List defaults: start=1970-01-01T00:00:00.000Z, end=current UTC time, page=0, pageSize=20.
List dates filter creation time. Raw GET /api/v1/backtests requires start and end.
Raw submission option: --body REQUEST.json
Credentials: home-directory .env.mesosim; environment variables do not override it.
No redirects or automatic retries. Exit codes: 0 success, 1 HTTP error, 2 input/transport error.
`;

export function parseArgs(argv) {
  const [command, ...args] = argv;
  const positionals = [];
  const options = { query: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const key = arg.slice(2);
    if (!['query', 'body', 'output', 'timeout', 'mode', 'enabled', 'shared'].includes(key)) throw new InputError('Unknown option. Run --help for usage.');
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw new InputError('An option value is missing.');
    if (key === 'query') {
      const equals = value.indexOf('=');
      if (equals < 1) throw new InputError('Each --query must be KEY=VALUE.');
      options.query.push([value.slice(0, equals), value.slice(equals + 1)]);
    } else {
      if (Object.hasOwn(options, key)) throw new InputError('Duplicate option.');
      options[key] = key === 'timeout' ? Number(value) : value;
    }
  }
  const local = ['setup', 'docs', 'prepare'].includes(command);
  const allowed = local ? (command === 'prepare' ? ['output', 'shared'] : []) : ['output', 'timeout', 'query'];
  if (['GET', 'PUT', 'POST', 'DELETE'].includes(command)) allowed.push('body');
  if (command === 'delete') allowed.push('mode');
  if (command === 'sharing') allowed.push('enabled');
  for (const key of Object.keys(options)) {
    if (key === 'query' && options.query.length === 0) continue;
    if (!allowed.includes(key)) throw new InputError('Option is not supported by this command.');
  }
  const noArgs = ['setup', 'docs', 'list'].includes(command);
  if (positionals.length !== (noArgs ? 0 : 1)) throw new InputError('Wrong number of command arguments. Run --help for usage.');
  if (local) return { command, positionals, options };
  let method = 'GET';
  let path;
  if (['GET', 'PUT', 'POST', 'DELETE'].includes(command)) {
    method = command; path = positionals[0];
  } else if (command === 'list') {
    path = '/api/v1/backtests';
    const defaults = { start: '1970-01-01T00:00:00.000Z', end: new Date().toISOString(), page: '0', pageSize: '20' };
    for (const [key, value] of Object.entries(defaults)) {
      if (!options.query.some(([supplied]) => supplied === key)) options.query.push([key, value]);
    }
  } else if (command === 'submit') { method = 'PUT'; path = '/api/v1/backtest/new'; options.body = positionals[0]; }
  else {
    if (!['status', 'cancel', 'analytics', 'strategy', 'events', 'navs', 'external-data', 'sharing', 'delete'].includes(command)) throw new InputError('Unknown command. Run --help for usage.');
    const id = encodeURIComponent(positionals[0]);
    path = `/api/v1/backtest/${id}`;
    if (command === 'delete') {
      method = 'DELETE';
      if (!options.mode) throw new InputError('delete requires --mode Soft, Details, or Full.');
      options.query.push(['deleteMode', options.mode]);
    } else {
      path += '/' + (command === 'strategy' ? 'strategy-definition' : command);
      if (command === 'cancel') method = 'POST';
      if (command === 'sharing' && options.enabled !== undefined) { method = 'POST'; options.query.push(['sharingEnabled', options.enabled]); }
    }
  }
  return { command, request: { method, path, ...options } };
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || (argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0]))) { console.log(help); return 0; }
  if (argv.length === 1 && argv[0] === '--version') { console.log(version); return 0; }
  try {
    const parsed = parseArgs(argv);
    if (parsed.command === 'prepare') {
      if (parsed.options.shared !== undefined && !['true', 'false'].includes(parsed.options.shared)) throw new InputError('--shared must be true or false.');
      console.log(JSON.stringify(await prepareSubmission(parsed.positionals[0], parsed.options.output, parsed.options.shared === 'true'), null, 2));
      return 0;
    }
    if (parsed.command === 'docs') {
      let config;
      try { config = await loadConfig(); } catch { /* Public docs require no API key. Do not invent a configured MCP origin. */ }
      console.log(JSON.stringify({ mcp: config ? `${config.origin}/mcp/meso-docs` : null, library: 'mesosim-docs', libraries: { 'service': 'Service intro and guidelines (read once on first plugin use each session and adhere throughout)', 'mesosim-docs': 'MesoSim documentation (default)', 'mesolive-docs': 'MesoLive documentation', 'deltaray-blog': 'Deltaray blog articles', 'strategy-library': 'Strategy examples and reference strategies' }, configuration: config ? 'valid; reconnect MCP after file changes' : 'missing or invalid; use public docs or correct the home-directory .env.mesosim', fallback: 'https://docs.mesosim.io', instruction: 'On first MesoSim plugin use each session, use the host MCP client to read the complete intro and guidelines documents from the service catalog and adhere to their applicable guidance throughout the session. Retain this in session context; do not re-read for each command. If unavailable, report that service guidance is pending and read it when access is restored. Use the host MCP client for the configured instance and select the relevant libraries by topic using the discovered tool schema. Default to mesosim-docs for MesoSim documentation; consult multiple libraries when relevant. If unavailable, browse the web fallback. Never send the API key to web docs.' }, null, 2));
      return 0;
    }
    if (parsed.command === 'setup') {
      const status = await setupStatus();
      console.log(JSON.stringify({ version, ...status, mcpTransport: 'bundled stdio bridge', fallback: 'https://docs.mesosim.io' }, null, 2));
      return status.configuration === 'ready' ? 0 : 2;
    }
    const config = await loadConfig();
    return await requestApi(config, parsed.request);
  } catch (error) {
    console.error(error instanceof InputError ? error.message : 'Request/configuration failed. Check arguments, files, connectivity, and the home-directory .env.mesosim. Never paste the key into chat. No automatic retry was made; recover an uncertain submission with the same saved request.');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
