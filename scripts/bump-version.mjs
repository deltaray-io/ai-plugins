import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const repository = fileURLToPath(new URL('../', import.meta.url));
const targets = [
  ['package.json', ['version']],
  ['package-lock.json', ['version'], ['packages', '', 'version']],
  ['plugins/mesosim/.claude-plugin/plugin.json', ['version']],
  ['plugins/mesosim/.codex-plugin/plugin.json', ['version']],
  ['plugins/ai-researcher/.claude-plugin/plugin.json', ['version']],
  ['plugins/ai-researcher/.codex-plugin/plugin.json', ['version']],
  ['.claude-plugin/marketplace.json', ['metadata', 'version'], ['plugins', 0, 'version'], ['plugins', 1, 'version']],
];

export async function syncVersions(root, expected, check) {
  const documents = await Promise.all(targets.map(async ([file, ...paths]) => ({ file, paths, json: JSON.parse(await readFile(join(root, file), 'utf8')) })));
  expected ??= documents[0].json.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(expected)) throw new Error('Expected a semantic version, such as 0.2.0.');
  const mismatches = [];
  for (const { file, paths, json } of documents) for (const keys of paths) {
    const parent = keys.slice(0, -1).reduce((value, key) => value[key], json);
    const key = keys.at(-1);
    if (parent[key] !== expected) mismatches.push(`${file}: ${keys.join('.')}`);
    parent[key] = expected;
  }
  if (check && mismatches.length) throw new Error(`Version mismatch: ${mismatches.join(', ')}`);
  if (!check) for (const { file, json } of documents) await writeFile(join(root, file), JSON.stringify(json, null, 2) + '\n');
  return expected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) throw new Error('Usage: node scripts/bump-version.mjs <version>|--check');
    const check = args[0] === '--check';
    console.log(`Version metadata ${check ? 'matches' : 'set to'} ${await syncVersions(repository, check ? undefined : args[0], check)}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
