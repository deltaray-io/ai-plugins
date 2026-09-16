import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InputError } from './config.mjs';

export const endpointPath = '/mcp/fundpro-docs';
const unavailable = 'AI Researcher guidance was not loaded; stop research.';
export const diagnostic = error => error instanceof InputError ? error.message : 'MCP transport failed. Check the configured instance and reconnect.';

// This fetch is used for every SDK request. Refuse redirects, discovery, and
// credential forwarding to anything except the exact configured endpoint.
export function instanceFetch(config, { fetchImpl = fetch, headerTimeoutMs = 10000 } = {}) {
  const endpoint = `${config.origin}${endpointPath}`;
  return async (input, init = {}) => {
    if (new URL(input instanceof Request ? input.url : input).href !== endpoint) {
      throw new InputError('MCP refused a request outside the configured research endpoint.');
    }
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${config.token}`);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), headerTimeoutMs);
    let response;
    try {
      response = await fetchImpl(endpoint, { ...init, headers, redirect: 'manual', signal: init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal });
    } catch {
      throw new InputError('MCP connection failed or timed out. Check MESOSIM_INSTANCE and connectivity; no request was retried.');
    } finally { clearTimeout(timer); }
    const method = init.method ?? 'GET';
    if (response.status === 405 && ['GET', 'DELETE'].includes(method)) return response;
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400) throw new InputError('MCP endpoint returned a redirect, which was refused. Check MESOSIM_INSTANCE.');
      if ([401, 403].includes(response.status)) throw new InputError(`MCP returned HTTP ${response.status}. Check the API key and FundPro MCP access for this instance.`);
      throw new InputError(`MCP returned HTTP ${response.status}. Check research service access; no request was retried.`);
    }
    const mediaType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (![202, 204].includes(response.status) && method !== 'DELETE' && !['application/json', 'text/event-stream'].includes(mediaType)) {
      await response.body?.cancel();
      throw new InputError('The configured research endpoint returned a non-MCP response. Check MESOSIM_INSTANCE and service access.');
    }
    return response;
  };
}

export async function startBridge(config, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, fetchImpl = fetch, initializeTimeoutMs = 8000 } = {}) {
  const remote = new StreamableHTTPClientTransport(new URL(`${config.origin}${endpointPath}`), {
    fetch: instanceFetch(config, { fetchImpl }),
    reconnectionOptions: { initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1, maxRetries: 0 },
  });
  const local = new StdioServerTransport(stdin, stdout, { maxBufferSize: 4 * 1024 * 1024 });
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  let closing = false;
  let initializeId;
  let initializeTimer;
  let outputQueue = Promise.resolve();
  const pending = new Set();
  const sendLocal = message => (outputQueue = outputQueue.then(() => local.send(message)));

  async function close(error) {
    if (closing) return done;
    closing = true;
    clearTimeout(initializeTimer);
    stdin.off('end', onEnd);
    let cleanupTimer;
    const deadline = new Promise(resolve => { cleanupTimer = setTimeout(resolve, 1500); });
    try {
      if (error) {
        const message = `${diagnostic(error)} ${unavailable}`;
        stderr.write(`fundpro-doc: ${message}\n`);
        for (const id of pending) sendLocal({ jsonrpc: '2.0', id, error: { code: -32000, message } });
        await Promise.race([outputQueue, deadline]);
      } else {
        await Promise.race([remote.terminateSession().catch(() => {}), deadline]);
      }
    } finally {
      clearTimeout(cleanupTimer);
      await remote.close();
      await local.close();
      finish(error ? 1 : 0);
    }
    return done;
  }
  const onEnd = () => { void close(); };
  local.onerror = error => { void close(error); };
  remote.onerror = error => { void close(error); };
  remote.onmessage = message => {
    if (closing) return;
    if (!('method' in message)) {
      pending.delete(message.id);
      if (message.id === initializeId && typeof message.result?.protocolVersion === 'string') {
        remote.setProtocolVersion(message.result.protocolVersion);
        clearTimeout(initializeTimer);
      }
    }
    sendLocal(message).catch(error => { void close(error); });
  };
  local.onmessage = message => {
    if (closing) return;
    if ('method' in message && 'id' in message) pending.add(message.id);
    if (message.method === 'initialize') {
      initializeId = message.id;
      clearTimeout(initializeTimer);
      initializeTimer = setTimeout(() => { void close(new InputError('MCP initialization timed out for the configured research endpoint.')); }, initializeTimeoutMs);
    }
    remote.send(message).catch(error => { void close(error); });
  };
  await remote.start();
  stdin.once('end', onEnd);
  await local.start();
  return { close, done };
}
