<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Verification
Always run `npm run type-check` after making changes to verify basic syntax errors.

# Privacy & Paths
- **Never** include absolute filesystem paths (e.g., `/Users/username/...`) in any code, documentation, or commit messages.
- Always use **relative paths** for internal links and documentation.
- If an absolute path is required for local configuration, use placeholder strings or rely strictly on environment variables.

# Skills
Consult the `skills/` directory for specific guides and automation patterns:
- [Pull Request Creation](skills/pull-request.md)
- [Registry Migration](skills/registry-migration.md)
