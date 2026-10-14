/** Iteration data files: CSV (RFC 4180-ish) or a JSON array of objects. Every value becomes a string. */
export type DataRow = Record<string, string>;

export function parseCsv(text: string): DataRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length < 2) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function parseDataFile(text: string, nameHint = ''): DataRow[] {
  const trimmed = text.trim();
  if (nameHint.toLowerCase().endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as unknown;
    const arr = Array.isArray(json) ? json : [json];
    return arr.map((o) => {
      if (o === null || typeof o !== 'object') throw new Error('JSON data file must be an array of objects');
      return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)]));
    });
  }
  return parseCsv(text);
}
