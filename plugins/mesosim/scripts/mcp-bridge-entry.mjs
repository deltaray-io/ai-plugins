import { loadConfig, setupStatus } from './lib/config.mjs';
import { startBridge, diagnostic } from './lib/mcp-bridge.mjs';
import { startSetupServer } from './lib/mcp-setup.mjs';

try {
  const status = await setupStatus();
  const bridge = status.configuration === 'ready'
    ? await startBridge(await loadConfig())
    : await startSetupServer(status);
  const stop = () => { void bridge.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.stdout.on('error', stop);
  process.exitCode = await bridge.done;
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
} catch (error) {
  console.error(`meso-doc: ${diagnostic(error)} Use https://docs.mesosim.io if documentation MCP is unavailable.`);
  process.exitCode = 1;
}
