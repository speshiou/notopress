import { describe, expect, it } from 'vitest';
import { validatePulledMarkdown } from './wordpress-pull-validation';

describe('validatePulledMarkdown', () => {
  it('accepts contiguous tables and normal paragraph spacing', () => {
    expect(() => validatePulledMarkdown({
      sourceContent: '<table><tr><th>Name</th></tr><tr><td>A</td></tr></table>',
      markdown: '| Name |\n| --- |\n| A |\n\nFollowing paragraph.',
    })).not.toThrow();
  });

  it('accepts two separate tables divided by blank lines', () => {
    expect(() => validatePulledMarkdown({
      sourceContent: '<table></table><table></table>',
      markdown: '| First |\n| --- |\n| A |\n\n| Second |\n| --- |\n| B |',
    })).not.toThrow();
  });

  it('rejects table rows detached by blank lines', () => {
    expect(() => validatePulledMarkdown({
      sourceContent: '<table><tr><th>Name</th></tr><tr><td>A</td></tr></table>',
      markdown: '| Name |\n| --- |\n\n| A |',
    })).toThrow('table row at line 4 is detached');
  });

  it('rejects empty output from non-empty source content', () => {
    expect(() => validatePulledMarkdown({
      sourceContent: '<p>Important content</p>',
      markdown: '',
    })).toThrow('non-empty source content converted to empty Markdown');
  });
});
