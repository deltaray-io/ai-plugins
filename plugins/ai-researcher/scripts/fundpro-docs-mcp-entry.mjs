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
  console.error(`fundpro-doc: ${diagnostic(error)} AI Researcher guidance was not loaded; stop research.`);
  process.exitCode = 1;
}
