import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  }));
  return nested.flat();
}

describe('script architecture boundaries', () => {
  it('keeps core independent from adapters, application orchestration, CLI, and infrastructure', async () => {
    const files = await listTypeScriptFiles(path.join(process.cwd(), 'scripts', 'core'));
    for (const file of files) {
      const source = await readFile(file, 'utf-8');
      expect(source, file).not.toMatch(/from ['"].*(?:adapters|application|cli|infrastructure)\//);
    }
  });

  it('keeps application orchestration independent from concrete adapter modules', async () => {
    const files = await listTypeScriptFiles(path.join(process.cwd(), 'scripts', 'application'));
    for (const file of files) {
      const source = await readFile(file, 'utf-8');
      expect(source, file).not.toMatch(/from ['"].*adapters\/wordpress\//);
    }
  });

  it('keeps WordPress implementation and tests inside its adapter package', async () => {
    const scriptFiles = await listTypeScriptFiles(path.join(process.cwd(), 'scripts'));
    const misplaced = scriptFiles.filter((file) => (
      path.basename(file).toLowerCase().includes('wordpress')
      && !file.includes(`${path.sep}adapters${path.sep}wordpress${path.sep}`)
    ));
    expect(misplaced).toEqual([]);
  });
});
