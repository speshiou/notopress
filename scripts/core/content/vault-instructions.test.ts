import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS_BEGIN, INSTRUCTIONS_END, prepareVaultInstructionsPlan } from './vault-instructions';

const template = '## NotoPress workflow\n\nShared guidance.';
const prepare = (existingContent: string | null) => prepareVaultInstructionsPlan({ existingContent, template });

describe('managed vault instruction plans', () => {
  it('creates or appends one shared block without changing owner bytes', () => {
    const fresh = prepare(null);
    expect(fresh.content).toBe(`${INSTRUCTIONS_BEGIN}\n${template}\n${INSTRUCTIONS_END}\n`);
    expect(fresh.plan.operations[0]).toMatchObject({ path: 'AGENTS.md', previousHash: null });
    const owner = '# Owner instructions\r\nKeep this exactly.  ';
    expect(prepare(owner).content.startsWith(`${owner}\n\n${INSTRUCTIONS_BEGIN}`)).toBe(true);
  });
  it('replaces only its existing block and stays unchanged on subsequent interactions', () => {
    const prefix = '# Owner\r\n\r\n';
    const suffix = '\r\n\r\nOwner footer.  \r\n';
    const updated = prepare(`${prefix}${INSTRUCTIONS_BEGIN}\nOld instructions\n${INSTRUCTIONS_END}${suffix}`);
    expect(updated.content).toBe(`${prefix}${INSTRUCTIONS_BEGIN}\n${template}\n${INSTRUCTIONS_END}${suffix}`);
    expect(prepare(updated.content)).toMatchObject({ changed: false, plan: { operations: [] } });
  });
  it.each([
    INSTRUCTIONS_BEGIN, INSTRUCTIONS_END,
    `${INSTRUCTIONS_END}\n${INSTRUCTIONS_BEGIN}`,
    `${INSTRUCTIONS_BEGIN}\n${INSTRUCTIONS_BEGIN}\n${INSTRUCTIONS_END}`,
    `${INSTRUCTIONS_BEGIN}\n${INSTRUCTIONS_END}\n${INSTRUCTIONS_END}`,
  ])('rejects ambiguous markers without guessing at owner content', (existing) => {
    expect(() => prepare(existing)).toThrow('Malformed NotoPress managed block');
  });
  it('fingerprints template and owner changes without exposing owner content', () => {
    const first = prepare('Owner notes');
    expect(prepare('Changed owner notes').plan.fingerprint).not.toBe(first.plan.fingerprint);
    expect(prepareVaultInstructionsPlan({ existingContent: 'Owner notes', template: 'Updated template' }).plan.fingerprint).not.toBe(first.plan.fingerprint);
    expect(JSON.stringify(first.plan)).not.toContain('Owner notes');
  });
});
