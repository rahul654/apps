import { describe, expect, it } from 'vitest';
import { searchTools, TOOLS } from './registry';

describe('tool registry', () => {
  it('has unique ids', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
  });
  it('searches names, keywords and sub-tools', () => {
    expect(searchTools('').length).toBe(TOOLS.length);
    expect(searchTools('sha256').map((t) => t.id)).toEqual(['hash']);
    expect(searchTools('epoch').map((t) => t.id)).toEqual(['timestamp']);
    expect(searchTools('kebab').map((t) => t.id)).toEqual(['converters']);
    expect(searchTools('json diff').map((t) => t.id)).toEqual(['json']);
    expect(searchTools('zzzz')).toEqual([]);
  });
});
