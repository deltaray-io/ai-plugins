import {
  InputError,
  configPath,
  ensureConfigFile,
  loadConfig,
  parseConfig,
} from '../../../mesosim/scripts/lib/config.mjs';
import { ensureWorkspace, workspacePath } from './workspace.mjs';

export { InputError, configPath, ensureConfigFile, loadConfig, parseConfig };

export async function setupStatus() {
  let workspace;
  try {
    workspace = await ensureWorkspace();
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    workspace = { configuration: 'needs_setup', root: workspacePath(), reason: error.message };
  }
  const workspaceStatus = workspace.configuration === 'ready'
    ? { configuration: 'ready', root: workspace.root }
    : workspace;

  let created = false;
  try {
    created = await ensureConfigFile();
    await loadConfig();
    if (workspace.configuration !== 'ready') {
      return {
        configuration: 'needs_setup', configFile: configPath(), created,
        workspace: workspaceStatus,
        reason: workspace.reason,
        instructions: `Repair the local FundPro workspace at ${workspace.root}, then call ai_researcher_setup again. Existing files are preserved.`,
      };
    }
    return {
      configuration: 'ready', configFile: configPath(), created,
      workspace: workspaceStatus,
      credentials: 'present; service access not tested',
    };
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const workspaceInstruction = workspace.configuration === 'ready'
      ? ''
      : ` Repair the local FundPro workspace at ${workspace.root}: ${workspace.reason}`;
    return {
      configuration: 'needs_setup', configFile: configPath(), created, workspace: workspaceStatus,
      reason: `${error.message}${workspaceInstruction}`,
      instructions: `Edit this file locally. Set MESOSIM_INSTANCE to your FundPro portal HTTPS origin, create a key at that portal's /api/keys page, and enter it in MESOSIM_API_KEY.${workspaceInstruction} Then reconnect MCP or start a new session. Never paste the key into chat.`,
    };
  }
}
