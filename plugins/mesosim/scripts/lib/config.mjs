import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class InputError extends Error {}
export const configPath = () => join(homedir(), '.env.mesosim');

export async function ensureConfigFile() {
  const template = '# MesoSim plugin configuration. Fill in the API key locally; never paste it into chat.\n' +
    '# For FundPro, replace the Retail origin below with your portal HTTPS origin.\n' +
    '# Create an API key at your portal\'s /api/keys page.\n' +
    'MESOSIM_INSTANCE=https://mesosim.io\nMESOSIM_API_KEY=\n';
  try {
    await writeFile(configPath(), template, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw new InputError('Could not create ~/.env.mesosim. Create it locally or check home-directory write permissions.');
  }
}

// Shared by first MCP startup and the explicit CLI setup command. Never returns a key.
export async function setupStatus() {
  let created = false;
  try {
    created = await ensureConfigFile();
    const config = await loadConfig();
    return { configuration: 'ready', configFile: configPath(), created, instance: config.origin,
      mcp: `${config.origin}/mcp/meso-docs`,
      credentials: 'present; not tested against the API', apiKeys: `${config.origin}/api/keys` };
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    return { configuration: 'needs_setup', configFile: configPath(), created, reason: error.message,
      instructions: 'Edit this file locally. Set MESOSIM_INSTANCE to https://mesosim.io for Retail or your FundPro portal HTTPS origin. Create a key at that portal\'s /api/keys page and enter it in MESOSIM_API_KEY. Then reconnect MCP or start a new session. Never paste the key into chat.',
      fallback: 'https://docs.mesosim.io' };
  }
}

export function parseConfig(text) {
  const values = new Map();
  for (let line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/^export\s+/, '');
    const separator = line.indexOf('=');
    const key = (separator < 0 ? line : line.slice(0, separator)).trim();
    if (!['MESOSIM_INSTANCE', 'MESOSIM_API_KEY'].includes(key)) continue;
    if (separator < 0 || values.has(key)) throw new InputError(`Invalid or duplicate ${key} in .env.mesosim.`);
    let value = line.slice(separator + 1).trim();
    if (/^['"]/.test(value)) {
      const end = value.indexOf(value[0], 1);
      if (end < 0 || !/^(?:\s*#.*|\s*)$/.test(value.slice(end + 1))) {
        throw new InputError(`Invalid quoted ${key} in .env.mesosim.`);
      }
      value = value.slice(1, end);
    } else value = value.replace(/\s+#.*$/, '').trimEnd();
    values.set(key, value);
  }
  const instance = values.get('MESOSIM_INSTANCE');
  const token = values.get('MESOSIM_API_KEY');
  if (!instance || !token) throw new InputError('Set both MESOSIM_INSTANCE and MESOSIM_API_KEY in ~/.env.mesosim. Never paste the key into chat.');
  if (!/^[\x21-\x7e]+$/.test(token)) throw new InputError('MESOSIM_API_KEY must be printable ASCII without spaces.');
  let url;
  try { url = new URL(instance); } catch { /* Safe diagnostic below. */ }
  if (!url || /[\s\\?#]/.test(instance) || url.username || url.password ||
      url.pathname !== '/' || !/^https?:\/\/[^/]+\/*$/.test(instance) ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new InputError('MESOSIM_INSTANCE must be an HTTPS origin without a path; HTTP is allowed only on loopback.');
  }
  return { origin: url.origin, token };
}

export async function loadConfig() {
  let text;
  try { text = await readFile(configPath(), 'utf8'); }
  catch { throw new InputError('Create the home-directory .env.mesosim file with MESOSIM_INSTANCE=https://mesosim.io and MESOSIM_API_KEY=your-api-key. Never paste the key into chat.'); }
  return parseConfig(text);
}
