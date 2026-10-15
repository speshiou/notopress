import { readFile, access } from 'fs/promises';
import path from 'path';
import { RegistrySchema, type Registry } from '../../../src/domain/registry';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';
import { z } from 'zod';

/**
 * Loads and validates the registry configuration.
 * The path can be overridden via parameter or REGISTRY_PATH environment variable.
 */
export async function getRegistry(customPath?: string): Promise<Registry> {
  const defaultPath = path.join(process.cwd(), DEFAULT_REGISTRY_FILENAME);
  const registryPath = customPath || process.env.REGISTRY_PATH || defaultPath;

  try {
    await access(registryPath);
  } catch {
    throw new Error(`Registry file not found at: ${registryPath}. Please ensure registry.json exists or check REGISTRY_PATH.`);
  }

  try {
    const rawData = await readFile(registryPath, 'utf8');
    const jsonData = JSON.parse(rawData);

    // Validate with Zod schema
    return RegistrySchema.parse(jsonData);
  } catch (error: unknown) {
    const migrationGuidance = `
Tip: See skills/registry-migration/SKILL.md for migration guidance and src/domain/registry.ts for the current schema.`;

    if (error instanceof z.ZodError) {
      throw new Error(`Invalid registry structure: ${JSON.stringify(error.format(), null, 2)}${migrationGuidance}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load registry: ${message}${migrationGuidance}`);
  }
}
