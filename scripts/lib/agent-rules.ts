import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { exists } from './files';

type Logger = Pick<typeof console, 'log'>;

export type RuleModule = 'base' | 'wordpress';

export type AgentRulesDeps = {
  exists: (path: string) => Promise<boolean>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  readTemplate: (moduleName: RuleModule) => Promise<string>;
  joinPath: (...paths: string[]) => string;
  logger: Logger;
};

const AGENTS_FILENAME = 'AGENTS.md';
const BEGIN_MARKER = '<!-- BEGIN:notopress-vault-agent-rules -->';
const END_MARKER = '<!-- END:notopress-vault-agent-rules -->';

export function renderManagedBlock({
  baseTemplate,
  wordpressTemplate,
  siteId,
  isWordPressEnabled,
}: {
  baseTemplate: string;
  wordpressTemplate?: string;
  siteId?: string;
  isWordPressEnabled?: boolean;
}): string {
  const blocks: string[] = [baseTemplate.trim()];

  if (isWordPressEnabled && wordpressTemplate) {
    blocks.push(wordpressTemplate.trim());
  }

  const rawContent = blocks.join('\n\n');
  const targetSiteId = siteId || '<site-id>';
  const processedContent = rawContent.replace(/\{\{siteId\}\}/g, targetSiteId);

  return `${BEGIN_MARKER}\n${processedContent}\n${END_MARKER}`;
}

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
    async ensureVaultAgentRules({
      vaultPath,
      siteId,
      isWordPressEnabled,
      dryRun,
    }: {
      vaultPath: string;
      siteId?: string;
      isWordPressEnabled?: boolean;
      dryRun: boolean;
    }): Promise<void> {
      const baseTemplate = await deps.readTemplate('base');
      const wordpressTemplate = isWordPressEnabled ? await deps.readTemplate('wordpress') : undefined;

      const managedBlock = renderManagedBlock({
        baseTemplate,
        wordpressTemplate,
        siteId,
        isWordPressEnabled,
      });

      const agentsPath = deps.joinPath(vaultPath, AGENTS_FILENAME);
      const existingContent = (await deps.exists(agentsPath)) ? await deps.readFile(agentsPath, 'utf-8') : '';
      const nextContent = ensureTrailingNewline(replaceManagedBlock({ content: existingContent, block: managedBlock }));

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
  readTemplate: async (moduleName: RuleModule) => {
    const templateFileName = moduleName === 'base' ? 'vault-base.md' : 'wordpress.md';
    const templatePath = path.join(process.cwd(), 'src', 'templates', 'agent-rules', templateFileName);
    return readFile(templatePath, 'utf-8');
  },
  joinPath: path.join,
  logger: console,
});

export const ensureVaultAgentRules = defaultAgentRulesWriter.ensureVaultAgentRules;
