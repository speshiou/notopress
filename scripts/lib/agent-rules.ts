import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { exists } from './files';

type Logger = Pick<typeof console, 'log'>;

export type AgentRulesDeps = {
  exists: (path: string) => Promise<boolean>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  joinPath: (...paths: string[]) => string;
  logger: Logger;
};

const AGENTS_FILENAME = 'AGENTS.md';
const BEGIN_MARKER = '<!-- BEGIN:notopress-vault-agent-rules -->';
const END_MARKER = '<!-- END:notopress-vault-agent-rules -->';

const VAULT_AGENT_RULES = `${BEGIN_MARKER}
# This is a Notopress vault

This vault is synced by Notopress. Edit source Markdown files and source assets, but do not manually edit generated files such as \`root.json\`, directory-level \`index.json\`, or generated thumbnails. Regenerate them with the Notopress sync tooling when needed.

Keep article metadata consistent with the surrounding Markdown files. Preserve existing frontmatter fields unless the edit explicitly requires changing them.

For captions, use a single italic paragraph immediately after the media or table. For table captions, place the caption directly after the Markdown table, for example: \`*Feature comparison table.*\`. Plain paragraphs are treated as normal article text, not captions.
${END_MARKER}`;

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function appendManagedBlock({ content, block }: { content: string; block: string }): string {
  const trimmedContent = content.trimEnd();
  return trimmedContent ? `${trimmedContent}\n\n${block}\n` : `${block}\n`;
}

function removeMarker(content: string, marker: string): string {
  return content.replace(marker, '').replace(/\n{3,}/g, '\n\n');
}

function replaceManagedBlock({ content, block }: { content: string; block: string }): string {
  const startIndex = content.indexOf(BEGIN_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  if (startIndex === -1 && endIndex === -1) {
    return appendManagedBlock({ content, block });
  }

  if (startIndex === -1) {
    return appendManagedBlock({ content: removeMarker(content, END_MARKER), block });
  }

  if (endIndex === -1) {
    return appendManagedBlock({ content: removeMarker(content, BEGIN_MARKER), block });
  }

  if (endIndex < startIndex) {
    return appendManagedBlock({
      content: removeMarker(removeMarker(content, BEGIN_MARKER), END_MARKER),
      block,
    });
  }

  const before = content.slice(0, startIndex).trimEnd();
  const after = content.slice(endIndex + END_MARKER.length).trimStart();
  const prefix = before ? `${before}\n\n` : '';
  const suffix = after ? `\n\n${after}` : '';

  return `${prefix}${block}${suffix}`;
}

export function createAgentRulesWriter(deps: AgentRulesDeps) {
  return {
    async ensureVaultAgentRules({ vaultPath, dryRun }: { vaultPath: string; dryRun: boolean }): Promise<void> {
      const agentsPath = deps.joinPath(vaultPath, AGENTS_FILENAME);
      const existingContent = (await deps.exists(agentsPath)) ? await deps.readFile(agentsPath, 'utf-8') : '';
      const nextContent = ensureTrailingNewline(replaceManagedBlock({ content: existingContent, block: VAULT_AGENT_RULES }));

      if (nextContent === ensureTrailingNewline(existingContent)) {
        deps.logger.log(`✅ ${AGENTS_FILENAME} agent rules are up to date.`);
        return;
      }

      if (dryRun) {
        deps.logger.log(`[DRY RUN] Would update vault ${AGENTS_FILENAME} at: ${agentsPath}`);
        return;
      }

      await deps.writeFile(agentsPath, nextContent);
      deps.logger.log(`✨ Updated vault ${AGENTS_FILENAME} agent rules.`);
    },
  };
}

const defaultAgentRulesWriter = createAgentRulesWriter({
  exists,
  readFile,
  writeFile,
  joinPath: path.join,
  logger: console,
});

export const ensureVaultAgentRules = defaultAgentRulesWriter.ensureVaultAgentRules;
