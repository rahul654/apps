/**
 * The only place that knows where song data comes from. Today: the bundled catalog.json.
 * Phase 2 swaps `loadCatalog` for a fetch from a Google Apps Script; the UI already treats it
 * as an async load with loading and error states.
 */
import type { Catalog, Category, Segment, Song } from '../types';

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

type Obj = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new CatalogError(`Song data is invalid at ${path}: ${message}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  return v as Obj;
}

function str(o: Obj, key: string, path: string, opts: { nonEmpty?: boolean } = {}): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${path}.${key}`, `expected a string, got ${describe(v)}`);
  if (opts.nonEmpty && v.trim() === '') fail(`${path}.${key}`, 'must not be empty');
  return v;
}

function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, `expected a number, got ${describe(v)}`);
  return v;
}

function arr(o: Obj, key: string, path: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(`${path}.${key}`, `expected an array, got ${describe(v)}`);
  return v;
}

function describe(v: unknown): string {
  if (v === undefined) return 'nothing (missing)';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
  return typeof v === 'object' ? 'an object' : String(v);
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CATEGORY_ID = /^[A-Za-z0-9_-]+$/;

function parseSegment(v: unknown, path: string, rank: number, duration: number): Segment {
  const o = obj(v, path);
  const r = num(o, 'rank', path);
  if (r !== rank) fail(`${path}.rank`, `expected ${rank} (ranks run 1..n in order), got ${r}`);
  const start = num(o, 'start', path);
  const end = num(o, 'end', path);
  if (!Number.isInteger(start) || start < 0) fail(`${path}.start`, `expected whole seconds ≥ 0, got ${start}`);
  if (!Number.isInteger(end)) fail(`${path}.end`, `expected whole seconds, got ${end}`);
  if (end <= start) fail(`${path}.end`, `must be after start (start ${start}, end ${end})`);
  if (end > duration) fail(`${path}.end`, `is past the song's duration (end ${end}, duration ${duration})`);
  const score = num(o, 'score', path);
  if (score < 0 || score > 1) fail(`${path}.score`, `expected 0..1, got ${score}`);
  const seg: Segment = { rank: r, start, end, score };
  if (o.edited !== undefined) {
    if (typeof o.edited !== 'boolean') fail(`${path}.edited`, `expected true/false, got ${describe(o.edited)}`);
    seg.edited = o.edited;
  }
  return seg;
}

function parseSong(v: unknown, path: string): Song {
  const o = obj(v, path);
  const videoId = str(o, 'videoId', path);
  if (!VIDEO_ID.test(videoId)) fail(`${path}.videoId`, `expected an 11-character YouTube id, got "${videoId}"`);
  const title = str(o, 'title', path);
  const name = str(o, 'name', path, { nonEmpty: true });
  const artist = str(o, 'artist', path);
  const duration = num(o, 'duration', path);
  if (duration <= 0) fail(`${path}.duration`, `expected seconds > 0, got ${duration}`);
  const source = o.source;
  if (source !== 'heatmap' && source !== 'fallback') fail(`${path}.source`, `expected "heatmap" or "fallback", got ${describe(source)}`);
  const heatmap = arr(o, 'heatmap', path).map((h, i) => {
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0 || h > 1) fail(`${path}.heatmap[${i}]`, `expected a number 0..1, got ${describe(h)}`);
    return h;
  });
  if (source === 'fallback' && heatmap.length > 0) fail(`${path}.heatmap`, 'must be empty for a "fallback" song');
  const rawSegments = arr(o, 'segments', path);
  if (rawSegments.length === 0) fail(`${path}.segments`, 'must have at least one segment');
  const segments = rawSegments.map((s, i) => parseSegment(s, `${path}.segments[${i}]`, i + 1, duration));
  return { videoId, title, name, artist, duration, source, heatmap, segments };
}

function parseCategory(v: unknown, path: string): Category {
  const o = obj(v, path);
  const id = str(o, 'id', path, { nonEmpty: true });
  if (!CATEGORY_ID.test(id)) fail(`${path}.id`, `must be URL-safe (letters, digits, - and _), got "${id}"`);
  const title = str(o, 'title', path, { nonEmpty: true });
  const playlistId = str(o, 'playlistId', path);
  const songs = arr(o, 'songs', path).map((s, i) => parseSong(s, `${path}.songs[${i}]`));
  return { id, title, playlistId, songs };
}

/** Checks the whole catalog and returns a clean copy; throws CatalogError naming the first bad field. */
export function parseCatalog(input: unknown): Catalog {
  const o = obj(input, 'catalog');
  if (o.version !== 1) fail('catalog.version', `expected 1, got ${describe(o.version)}`);
  const generatedAt = str(o, 'generatedAt', 'catalog');
  const categories = arr(o, 'categories', 'catalog').map((c, i) => parseCategory(c, `catalog.categories[${i}]`));
  const seen = new Set<string>();
  categories.forEach((c, i) => {
    if (seen.has(c.id)) fail(`catalog.categories[${i}].id`, `"${c.id}" is used by another category`);
    seen.add(c.id);
  });
  return { version: 1, generatedAt, categories };
}

export async function loadCatalog(): Promise<Catalog> {
  const data: unknown = (await import('../data/catalog.json')).default;
  return parseCatalog(data);
}
