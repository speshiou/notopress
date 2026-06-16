<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Verification
Always run `npm run type-check` after making changes to verify basic syntax errors.

# Architecture
- Keep main entrance files clean as orchestrators. Move feature logic, parsing, file scanning, rendering transforms, and other reusable behavior into focused modules instead of letting scripts or page files grow bloated.
- Module functions should strictly follow dependency injection patterns: pass filesystem, network, parser, logger, process, and other side-effect dependencies through explicit factory inputs or function parameters so modules stay extensible and testable.
- Add unit tests beside the module file at the same directory level whenever creating or substantially changing a module.

# Privacy & Paths
- **Never** include absolute filesystem paths (e.g., `/Users/username/...`) in any code, documentation, or commit messages.
- Always use **relative paths** for internal links and documentation.
- If an absolute path is required for local configuration, use placeholder strings or rely strictly on environment variables.

# Skills
Consult the `skills/` directory for specific guides and automation patterns:
- [Pull Request Creation](skills/pull-request/SKILL.md)
- [Registry Migration](skills/registry-migration/SKILL.md)
- [Coding Conventions](skills/coding-conventions/SKILL.md)
