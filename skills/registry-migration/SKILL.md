---
title: Registry Migration
description: Guidelines for migrating registry.json data to match the latest schema.
---

# Registry Migration Skill

As the project evolves, the structure of `registry.json` may change. This skill provides guidelines for migrating your registry data to match the latest schema.

## Schema Source of Truth
The canonical schema is defined in [src/domain/registry.ts](../../../src/domain/registry.ts) using Zod. Always refer to this file to see the expected structure.

## Migration Workflow

1.  **Backup**: Always create a backup of your `registry.json` before applying changes.
2.  **Analyze**: Compare your current `registry.json` with the `RegistrySchema` in `src/domain/registry.ts`.
3.  **Update**: Modify the JSON values or structure to comply with the new schema.
4.  **Validate**: Run a script to validate the file.

### Validation Script
You can use the following snippet to validate your registry file:

```typescript
// scripts/validate-registry.ts
import { getRegistry } from './infrastructure/config/registry';

async function main() {
  try {
    const registry = await getRegistry();
    console.log('✅ Registry is valid!');
    console.log(`Loaded ${registry.sites.length} sites.`);
  } catch (error: unknown) {
    console.error('❌ Registry validation failed:');
    console.error(error instanceof Error ? error.message : 'Registry validation failed.');
    process.exit(1);
  }
}

main();
```

Run it with:
```bash
npx tsx scripts/validate-registry.ts
```

## Automated Migrations
For significant structure changes, use a one-off script with explicit input and
output schemas. Read the file as `unknown`, validate it with Zod before transforming
it, and validate the result with `RegistrySchema` before writing. Keep credentials
out of logs, preserve unrelated settings, and keep the backup outside Git.
