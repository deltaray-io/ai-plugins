import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { InputError } from '../../../mesosim/scripts/lib/config.mjs';

export const workspacePath = () => join(homedir(), 'fundpro');
export const workspaceDirectories = ['trade_library', 'user_code', 'results', 'research'];

export const workspaceReadme = `# AI Researcher Workspace

AI Researcher uses this directory for local research files. New campaigns work in research/YYYY-MM-DD/subject-slug/. Preserve existing content and keep credentials out of this directory.

`;

async function existing(path, type) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (type === 'directory' ? !info.isDirectory() : !info.isFile())) {
      throw new InputError(`${path} must be a ${type}, not a symlink or another file type.`);
    }
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureDirectory(path, created) {
  if (await existing(path, 'directory')) return;
  try {
    await mkdir(path, { mode: 0o700 });
    created.push(path);
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await existing(path, 'directory'))) throw error;
  }
}

export async function ensureWorkspace() {
  const root = workspacePath();
  const created = [];
  try {
    await ensureDirectory(root, created);
    for (const name of workspaceDirectories) await ensureDirectory(join(root, name), created);
    const readme = join(root, 'README.md');
    if (!(await existing(readme, 'regular file'))) {
      try {
        await writeFile(readme, workspaceReadme, { flag: 'wx', mode: 0o600 });
        created.push(readme);
      } catch (error) {
        if (error.code !== 'EEXIST' || !(await existing(readme, 'regular file'))) throw error;
      }
    }
    return {
      configuration: 'ready',
      root,
      readme,
      tradeLibrary: join(root, 'trade_library'),
      userCode: join(root, 'user_code'),
      results: join(root, 'results'),
      research: join(root, 'research'),
      created,
    };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(`Could not prepare ${root}. Check home-directory permissions and required path types.`);
  }
}
