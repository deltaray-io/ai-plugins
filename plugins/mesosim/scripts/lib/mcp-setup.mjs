import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { setupStatus } from './config.mjs';

// Complete a real MCP handshake even before credentials exist. This mode makes no
// upstream requests and accepts no credentials through tool arguments.
export async function startSetupServer(status) {
  const instructions = `MesoSim needs local configuration in ${status.configFile}. Call mesosim_setup for instructions. Ask the user to enter their API key in that file locally, then reconnect MCP or start a new session.`;
  const server = new Server({ name: 'meso-doc-setup', version: '1.0.0' }, {
    capabilities: { tools: {} }, instructions,
  });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{
    name: 'mesosim_setup', title: 'Set up MesoSim', description: instructions,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { destructiveHint: false, openWorldHint: false },
  }] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (request.params.name !== 'mesosim_setup') throw new McpError(ErrorCode.MethodNotFound, 'Unknown setup tool.');
    if (Object.keys(request.params.arguments ?? {}).length) throw new McpError(ErrorCode.InvalidParams, 'This tool accepts no arguments. Edit credentials in the local file.');
    const current = await setupStatus();
    if (current.configuration === 'ready') current.instructions = 'Configuration is ready. Reconnect MCP or start a new session to load the documentation tools. Service access has not been tested.';
    return { content: [{ type: 'text', text: JSON.stringify(current, null, 2) }] };
  });
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const stop = () => { void server.close(); };
  server.onclose = () => { process.stdin.off('end', stop); finish(0); };
  server.onerror = () => { void server.close(); };
  process.stdin.once('end', stop);
  await server.connect(new StdioServerTransport());
  return { close: () => server.close(), done };
}
