import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { syncVersions } from './bump-version.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
await syncVersions(root, undefined, true);

const plugins = {
  mesosim: {
    codex: await json('plugins/mesosim/.codex-plugin/plugin.json'),
    claude: await json('plugins/mesosim/.claude-plugin/plugin.json'),
    mcp: await json('plugins/mesosim/.mcp.json'),
  },
  'ai-researcher': {
    codex: await json('plugins/ai-researcher/.codex-plugin/plugin.json'),
    claude: await json('plugins/ai-researcher/.claude-plugin/plugin.json'),
    mcp: await json('plugins/ai-researcher/.mcp.json'),
  },
};

for (const [name, plugin] of Object.entries(plugins)) for (const manifest of [plugin.codex, plugin.claude]) {
  assert.equal(manifest.name, name);
  assert.equal(manifest.author.name, 'Deltaray Research Ltd.');
  assert.equal(manifest.author.url, 'https://deltaray.io');
  assert.equal(manifest.homepage, 'https://mesosim.io');
}

assert.equal(plugins.mesosim.codex.skills, './skills/');
assert.deepEqual(plugins.mesosim.mcp, { mcpServers: { 'meso-doc': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/mesosim-mcp.mjs'] } } });
assert.deepEqual(plugins.mesosim.codex.mcpServers, { 'meso-doc': { command: 'node', cwd: '.', args: ['./scripts/mesosim-mcp.mjs'] } });
await access(join(root, 'plugins/mesosim/scripts/mesosim-mcp.mjs'));

assert.equal(plugins['ai-researcher'].codex.skills, './skills/');
assert.deepEqual(plugins['ai-researcher'].claude.dependencies, ['mesosim']);
assert.deepEqual(plugins['ai-researcher'].mcp, { mcpServers: { 'fundpro-doc': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/fundpro-docs-mcp.mjs'] } } });
assert.deepEqual(plugins['ai-researcher'].codex.mcpServers, { 'fundpro-doc': { command: 'node', cwd: '.', args: ['./scripts/fundpro-docs-mcp.mjs'] } });
await access(join(root, 'plugins/ai-researcher/scripts/fundpro-docs-mcp.mjs'));

const marketplaces = await Promise.all(['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json'].map(json));
for (const marketplace of marketplaces) {
  assert.equal(marketplace.name, 'deltaray');
  assert.deepEqual(marketplace.plugins.map(plugin => plugin.name).sort(), ['ai-researcher', 'mesosim']);
  for (const name of Object.keys(plugins)) {
    const entry = marketplace.plugins.find(plugin => plugin.name === name);
    const source = entry.source;
    assert.equal(typeof source === 'string' ? source : source.path, `./plugins/${name}`);
  }
}
for (const entry of marketplaces[0].plugins) {
  assert.deepEqual(entry.policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
}

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

const researcherRoot = join(root, 'plugins/ai-researcher');
const researcherSkill = await readFile(join(researcherRoot, 'skills/ai-researcher/SKILL.md'), 'utf8');
assert.match(researcherSkill, /FUNDPRO_RESEARCH_BOOTSTRAP_V1/);
assert.match(researcherSkill, /mesosim@deltaray/);
assert.deepEqual([...new Set(researcherSkill.match(/\bFUNDPRO_[A-Z0-9_]+\b/g))], ['FUNDPRO_RESEARCH_BOOTSTRAP_V1'], 'Only the public bootstrap token may ship in the skill.');
const researcherCommand = await readFile(join(researcherRoot, 'commands/research.md'), 'utf8');
assert.match(researcherCommand, /disable-model-invocation: true/);
assert.match(researcherCommand, /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/ai-researcher\/SKILL\.md/);
assert.ok(!researcherCommand.includes('!`'));

console.log('Both plugins, host manifests, marketplaces, MCP configs, skills, commands, bundles, and versions passed.');
