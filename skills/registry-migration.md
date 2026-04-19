# Registry Migration Skill

As the project evolves, the structure of `registry.json` may change. This skill provides guidelines for migrating your registry data to match the latest schema.

## Schema Source of Truth
The canonical schema is defined in [src/domain/registry.ts](../src/domain/registry.ts) using Zod. Always refer to this file to see the expected structure.

## Migration Workflow

1.  **Backup**: Always create a backup of your `registry.json` before applying changes.
2.  **Analyze**: Compare your current `registry.json` with the `RegistrySchema` in `src/domain/registry.ts`.
3.  **Update**: Modify the JSON values or structure to comply with the new schema.
4.  **Validate**: Run a script to validate the file.

### Validation Script
You can use the following snippet to validate your registry file:

```typescript
// scripts/validate-registry.ts
import { getRegistry } from '../src/lib/registry';

try {
  const registry = getRegistry();
  console.log('✅ Registry is valid!');
  console.log(`Loaded ${registry.sites.length} sites.`);
} catch (error: any) {
  console.error('❌ Registry validation failed:');
  console.error(error.message);
  process.exit(1);
}
```

Run it with:
```bash
npx tsx scripts/validate-registry.ts
```

## Automated Migrations
For significant structure changes, it is recommended to create a one-off migration script in the `scripts/` directory:

```typescript
// Example migration: Rename 'domain' to 'host'
import fs from 'fs';
const data = JSON.parse(fs.readFileSync('registry.json', 'utf8'));
data.sites = data.sites.map(s => ({ host: s.domain, ...s }));
data.sites.forEach(s => delete s.domain);
fs.writeFileSync('registry.json', JSON.stringify(data, null, 2));
```
