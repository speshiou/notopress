# Pull Request Skill

When creating pull requests for this repository, follow these guidelines:

## GitHub CLI (gh)
The GitHub CLI is used for PR management. Ensure `gh` is available in your environment. On macOS, if it's not in your `PATH`, it is often located at `/opt/homebrew/bin/gh` or `/usr/local/bin/gh`.

### Creating a Pull Request
Do not rely solely on `gh pr create --fill`. Instead, analyze the changes to write a high-quality title and description:

1. **Verify Code Quality**: Ensure all tests and type-checks pass before proceeding:
   ```bash
   npm run type-check
   npm run test
   ```
2. **Analyze the Diff**: Run a diff against the base branch (usually `main`) to understand exactly what changed:
   ```bash
   git diff main...$(git branch --show-current)
   ```
3. **Draft the Content**:
   - **Title**: A concise, imperative-style summary (e.g., "Add authentication middleware").
   - **Body**: A detailed summary of changes, typically using a bulleted list to highlight key modifications and rationale.
4. **Execute**:
   ```bash
   gh pr create --title "Your Title" --body "Your detailed summary"
   ```

### Verification Before Creation
Always check if a PR already exists for the current branch to avoid duplicates:
```bash
gh pr list --head $(git branch --show-current)
```

### Common Targets
- **Base Branch**: Use `main` as the default base branch unless specified otherwise.
