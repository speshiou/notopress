import fs from 'fs';
import path from 'path';
import { RegistrySchema, type Registry } from '../domain/registry';

/**
 * Loads and validates the registry configuration.
 * The path can be overridden via the REGISTRY_PATH environment variable.
 */
export function getRegistry(): Registry {
  const defaultPath = path.join(process.cwd(), 'registry.json');
  const registryPath = process.env.REGISTRY_PATH || defaultPath;

  if (!fs.existsSync(registryPath)) {
    throw new Error(`Registry file not found at: ${registryPath}. Please ensure registry.json exists or check REGISTRY_PATH.`);
  }

  try {
    const rawData = fs.readFileSync(registryPath, 'utf8');
    const jsonData = JSON.parse(rawData);
    
    // Validate with Zod schema
    return RegistrySchema.parse(jsonData);
  } catch (error: any) {
    const migrationGuidance = `
Tip: If your registry.json is outdated, you can use AI agents like Claude Code, OpenClaw, or other tools to help you migrate to the new schema. 
Refer to skills/registry-migration.md for detailed migration instructions and the current schema definition.`;

    if (error.name === 'ZodError') {
      throw new Error(`Invalid registry structure: ${JSON.stringify(error.format(), null, 2)}${migrationGuidance}`);
    }
    throw new Error(`Failed to load registry: ${error.message}${migrationGuidance}`);
  }
}
