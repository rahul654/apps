import { describe, expect, it } from 'vitest';
import { copyTitle, fileNameFor, normalizeTitle, relativeTime, searchBoards, sortBoards, titleFromFileName, uniqueTitle } from './format';

const b = (id: string, title: string, createdAt: number, updatedAt: number) => ({ id, title, createdAt, updatedAt });

describe('titles', () => {
  it('normalizes whitespace, control characters and length', () => {
    expect(normalizeTitle('  Sprint \n\t plan  ')).toBe('Sprint plan');
    expect(normalizeTitle('a\u0000b')).toBe('a b');
    expect(normalizeTitle('x'.repeat(300))).toHaveLength(100);
    expect(normalizeTitle('   ')).toBe('');
  });

  it('makes unique titles, case-insensitively', () => {
    expect(uniqueTitle('Plan', [])).toBe('Plan');
    expect(uniqueTitle('Plan', ['plan'])).toBe('Plan 2');
    expect(uniqueTitle('Plan', ['Plan', 'Plan 2'])).toBe('Plan 3');
    expect(uniqueTitle('Plan 2', ['Plan', 'Plan 2'])).toBe('Plan 3');
    expect(uniqueTitle('', [])).toBe('Untitled board');
  });

  it('copy titles do not stack', () => {
    expect(copyTitle('Plan', ['Plan'])).toBe('Plan (copy)');
    expect(copyTitle('Plan', ['Plan', 'Plan (copy)'])).toBe('Plan (copy 2)');
    expect(copyTitle('Plan (copy)', ['Plan', 'Plan (copy)'])).toBe('Plan (copy 2)');
  });

  it('derives titles and file names', () => {
    expect(titleFromFileName('Q3_plan.excalidraw')).toBe('Q3 plan');
    expect(titleFromFileName('notes.JSON')).toBe('notes');
    expect(fileNameFor('a/b: c?', 'excalidraw')).toBe('a-b- c-.excalidraw');
    expect(fileNameFor('   ', 'png')).toBe('board.png');
  });
});

describe('search and sort', () => {
  const list = [b('1', 'Café roadmap', 10, 300), b('2', 'Team kanban', 30, 100), b('3', 'Roadmap 10', 20, 200), b('4', 'Roadmap 9', 40, 200)];

  it('matches every term, ignoring case and accents', () => {
    expect(searchBoards(list, 'cafe').map((x) => x.id)).toEqual(['1']);
    expect(searchBoards(list, 'ROAD map').map((x) => x.id)).toEqual(['1', '3', '4']);
    expect(searchBoards(list, 'kanban road')).toEqual([]);
    expect(searchBoards(list, 'road 9').map((x) => x.id)).toEqual(['4']);
    expect(searchBoards(list, '  ')).toHaveLength(4);
  });

  it('sorts by last edit, name (numeric) and creation', () => {
    expect(sortBoards(list, 'edited').map((x) => x.id)).toEqual(['1', '4', '3', '2']);
    expect(sortBoards(list, 'name').map((x) => x.title)).toEqual(['Café roadmap', 'Roadmap 9', 'Roadmap 10', 'Team kanban']);
    expect(sortBoards(list, 'created').map((x) => x.id)).toEqual(['4', '2', '3', '1']);
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 9, 13, 15, 0).getTime();
  it('formats recent and old times', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(relativeTime(new Date(2026, 9, 12, 9).getTime(), now)).toBe('yesterday');
    expect(relativeTime(new Date(2026, 9, 9, 9).getTime(), now)).toBe('4 days ago');
    expect(relativeTime(new Date(2026, 2, 3).getTime(), now)).toBe('Mar 3');
    expect(relativeTime(new Date(2024, 2, 3).getTime(), now)).toBe('Mar 3, 2024');
  });
});
