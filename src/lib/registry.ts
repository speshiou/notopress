import fs from 'fs';
import path from 'path';
import { RegistrySchema, type Registry } from '../domain/registry';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
    if (error.name === 'ZodError') {
      throw new Error(`Invalid registry structure: ${JSON.stringify(error.format(), null, 2)}`);
    }
    throw new Error(`Failed to load registry: ${error.message}`);
  }
}
