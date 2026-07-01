<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Verification
- Always run `npm run type-check` after making changes to verify basic syntax errors.
- **Strictly avoid using `any` type** anywhere in the codebase. Always write proper TypeScript types, schemas, or interfaces for safety and clarity.

# Generated Content Indexes
- Treat vault `root.json` files and generated `index.json` files as build artifacts. Do not edit them during article/content edits.
- Article agents should update source Markdown and source assets only. Regenerate indexes with the existing sync/deploy tooling when explicitly requested.
- If generated index files appear in a diff after article edits, leave them unstaged and revert only those generated artifacts after confirming they were not intentionally requested.

# Architecture
- Keep main entrance files clean as orchestrators. Move feature logic, parsing, file scanning, rendering transforms, and other reusable behavior into focused modules instead of letting scripts or page files grow bloated.
- Module functions should strictly follow dependency injection patterns: pass filesystem, network, parser, logger, process, and other side-effect dependencies through explicit factory inputs or function parameters so modules stay extensible and testable.
- Add unit tests beside the module file at the same directory level whenever creating or substantially changing a module.
- **Single Source of Truth**: Strictly avoid duplicating code, logic, data structures, configurations, patterns (such as URL/path composition, file/folder resolution, parsing, etc.), or abstractions across the codebase. Always consolidate them into centralized, reusable modules and helper functions (e.g., in `src/lib/` or `scripts/lib/`) to maintain a single source of truth across all scripts, tools, and the frontend application.
- **Layered Architecture & Cross-Imports**: Strictly maintain a unidirectional layered dependency model. Under no circumstances should cross-layer or circular imports occur:
  - **Domain layer** (`src/domain/`) holds pure types and configurations. It must never import from other layers.
  - **Library layer** (`src/lib/`) contains business logic/services. It can import from `src/domain/`, but never from the application (`src/app/`) or scripts (`scripts/`).
  - **Application/Presentation layer** (`src/app/` / Next.js) can import from `src/lib/` and `src/domain/`.
  - **Scripts layer** (`scripts/` / CLI tools) can import from `src/lib/`, `src/domain/`, and local script helpers (`scripts/lib/`).


# Privacy & Paths
- **Never** include absolute filesystem paths (e.g., `/Users/username/...`) in any code, documentation, or commit messages.
- Always use **relative paths** for internal links and documentation.
- If an absolute path is required for local configuration, use placeholder strings or rely strictly on environment variables.

# Skills
Consult the `skills/` directory for specific guides and automation patterns:
- [Pull Request Creation](skills/pull-request/SKILL.md)
- [Registry Migration](skills/registry-migration/SKILL.md)
- [Coding Conventions](skills/coding-conventions/SKILL.md)
