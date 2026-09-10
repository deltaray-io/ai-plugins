import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { syncVersions } from './bump-version.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
await syncVersions(root, undefined, true);
const codex = await json('plugins/mesosim/.codex-plugin/plugin.json');
const claude = await json('plugins/mesosim/.claude-plugin/plugin.json');
for (const manifest of [codex, claude]) {
  assert.equal(manifest.name, 'mesosim');
  assert.equal(manifest.author.name, 'Deltaray Research Ltd.');
  assert.equal(manifest.author.url, 'https://deltaray.io');
  assert.equal(manifest.homepage, 'https://mesosim.io');
}
assert.equal(codex.skills, './skills/');
const mcp = await json('plugins/mesosim/.mcp.json');
assert.deepEqual(mcp, { mcpServers: { 'meso-doc': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/mesosim-mcp.mjs'] } } });
await access(join(root, 'plugins/mesosim/scripts/mesosim-mcp.mjs'));
assert.deepEqual(codex.mcpServers, { 'meso-doc': { command: 'node', cwd: '.', args: ['./scripts/mesosim-mcp.mjs'] } });
const marketplaces = await Promise.all(['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json'].map(json));
for (const marketplace of marketplaces) {
  assert.equal(marketplace.name, 'deltaray');
  assert.equal(marketplace.plugins[0].name, 'mesosim');
  const source = marketplace.plugins[0].source;
  assert.equal(typeof source === 'string' ? source : source.path, './plugins/mesosim');
}
assert.deepEqual(marketplaces[0].plugins[0].policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
const names = ['setup', 'docs', 'list', 'prepare', 'submit', 'status', 'cancel', 'analytics', 'strategy', 'events', 'navs', 'external-data', 'sharing', 'delete'];
const commandsDir = join(root, 'plugins/mesosim/commands');
assert.deepEqual((await readdir(commandsDir)).sort(), names.map(name => `${name}.md`).sort());
for (const name of names) {
  const text = await readFile(join(commandsDir, `${name}.md`), 'utf8');
  assert.match(text, /disable-model-invocation: true/);
  assert.match(text, /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/mesosim\/SKILL\.md/);
  assert.ok(!text.includes('!`'), 'Do not execute untrusted argument interpolation in prompts.');
}
const skillPath = join(root, 'plugins/mesosim/skills/mesosim');
const skill = await readFile(join(skillPath, 'SKILL.md'), 'utf8');
assert.match(skill, /https:\/\/docs\.mesosim\.io/);
for (const match of skill.matchAll(/\]\(([^)]+)\)/g)) {
  if (!match[1].startsWith('https:')) await access(join(skillPath, match[1]));
}
console.log('Both host manifests, marketplaces, MCP config, command coverage, skill links, and versions passed.');
