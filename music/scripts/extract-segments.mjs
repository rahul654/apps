#!/usr/bin/env node
/**
 * Builds src/data/catalog.json from the YouTube playlists in scripts/playlists.json.
 *
 * For every category: list the playlist with yt-dlp, walk it in order, fetch each video's metadata
 * (including the "Most replayed" heatmap) and keep the first `perCategory` songs that can be played in
 * an embedded player. Segments come from lib/segments.mjs. Hand edits in the existing catalog
 * (name, artist, segments marked `edited: true`) are kept.
 *
 * Usage: node scripts/extract-segments.mjs [--per-category N] [--only <categoryId>] [--dry-run]
 * Needs yt-dlp on PATH. Node built-ins only.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  cleanTitle,
  compactHeatmap,
  fallbackSegment,
  findSegments,
  mergeWithExisting,
} from './lib/segments.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYLISTS_FILE = path.join(HERE, 'playlists.json');
const CATALOG_FILE = path.join(HERE, '..', 'src', 'data', 'catalog.json');

const YT_DLP = 'yt-dlp';
const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const CONCURRENCY = 3;
/** yt-dlp errors that won't change on a retry. */
const PERMANENT_ERROR =
  /private video|video unavailable|has been removed|not available|members-only|account associated with this video has been terminated|sign in to confirm your age/i;

const out = (line = '') => process.stdout.write(`${line}\n`);
const err = (line = '') => process.stderr.write(`${line}\n`);

function parseArgs(argv) {
  const args = { perCategory: undefined, only: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--per-category') args.perCategory = Number(argv[++i]);
    else if (a.startsWith('--per-category=')) args.perCategory = Number(a.split('=')[1]);
    else if (a === '--only') args.only = argv[++i];
    else if (a.startsWith('--only=')) args.only = a.split('=')[1];
    else if (a === '--help' || a === '-h') {
      out('Usage: node scripts/extract-segments.mjs [--per-category N] [--only <categoryId>] [--dry-run]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.perCategory !== undefined && !(Number.isInteger(args.perCategory) && args.perCategory > 0)) {
    throw new Error('--per-category needs a positive whole number');
  }
  return args;
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(YT_DLP, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        const reason = (String(stderr).match(/ERROR:.*$/m) || [error.message])[0].trim();
        reject(Object.assign(new Error(reason), { permanent: PERMANENT_ERROR.test(reason) }));
      } else resolve(stdout);
    });
  });
}

/** Runs yt-dlp and parses its JSON output, retrying once unless the error is permanent. */
async function ytJson(args) {
  try {
    return JSON.parse(await run(args));
  } catch (e) {
    if (e.permanent) throw e;
    return JSON.parse(await run(args));
  }
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const describe = (song) =>
  song.segments.map((s) => `${fmt(s.start)}–${fmt(s.end)} (${s.score}${s.edited ? ', edited' : ''})`).join('  ');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function readCatalog() {
  try {
    const data = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
    return Array.isArray(data.categories) ? data : { categories: [] };
  } catch {
    return { categories: [] };
  }
}

/** Why a flat-playlist entry can be skipped without fetching it, or null. */
function flatSkipReason(entry) {
  if (!entry || !entry.id) return 'no video id';
  if (!entry.title || /^\[(private|deleted) video\]$/i.test(entry.title)) return 'private or deleted';
  if (entry.live_status === 'is_live' || entry.live_status === 'is_upcoming') return entry.live_status;
  return null;
}

/** Why a fetched video can't be used, or null. */
function videoSkipReason(info) {
  if (!info || !info.title) return 'unavailable (no title)';
  if (info.playable_in_embed === false) return 'not embeddable';
  if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming') {
    return info.live_status || 'live';
  }
  if (!(info.duration > 0)) return 'no duration';
  return null;
}

/** Builds a contract Song from yt-dlp's video JSON. */
function toSong(info) {
  const duration = Math.round(info.duration);
  const { name, artist } = cleanTitle(info.title);
  const segments = Array.isArray(info.heatmap) && info.heatmap.length > 0 ? findSegments(info.heatmap, duration) : [];
  const fromHeatmap = segments.length > 0;
  return {
    videoId: info.id,
    title: info.title,
    name,
    artist,
    duration,
    source: fromHeatmap ? 'heatmap' : 'fallback',
    heatmap: fromHeatmap ? compactHeatmap(info.heatmap) : [],
    segments: fromHeatmap ? segments : fallbackSegment(duration),
  };
}

/**
 * Walks the playlist in order and returns up to `want` usable songs plus the skipped entries.
 * Fetches up to CONCURRENCY videos at a time but accepts them strictly in playlist order.
 */
async function collectSongs(category, want, skipped) {
  const url = `https://www.youtube.com/playlist?list=${category.playlistId}`;
  const playlist = await ytJson(['--flat-playlist', '-J', '--no-warnings', url]);
  const entries = playlist.entries ?? [];

  const songs = [];
  let next = 0;
  while (songs.length < want && next < entries.length) {
    const batch = [];
    while (batch.length < Math.min(CONCURRENCY, want - songs.length) && next < entries.length) {
      const entry = entries[next++];
      const reason = flatSkipReason(entry);
      if (reason) skipped.push({ category: category.id, videoId: entry?.id ?? '?', reason });
      else batch.push(entry);
    }
    if (batch.length === 0) continue;
    const results = await Promise.allSettled(
      batch.map((e) =>
        ytJson(['-j', '--skip-download', '--no-warnings', '--no-playlist', `https://www.youtube.com/watch?v=${e.id}`]),
      ),
    );
    for (let i = 0; i < batch.length && songs.length < want; i++) {
      const r = results[i];
      const id = batch[i].id;
      if (r.status === 'rejected') {
        skipped.push({ category: category.id, videoId: id, reason: r.reason.message });
        continue;
      }
      const reason = videoSkipReason(r.value);
      if (reason) {
        skipped.push({ category: category.id, videoId: id, reason, title: r.value?.title });
        continue;
      }
      songs.push(toSong(r.value));
    }
  }
  return songs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(PLAYLISTS_FILE, 'utf8'));
  const perCategory = args.perCategory ?? config.perCategory;
  if (args.only && !config.categories.some((c) => c.id === args.only)) {
    throw new Error(`No category "${args.only}" in playlists.json`);
  }

  const existing = await readCatalog();
  const oldSongs = new Map();
  for (const cat of existing.categories) for (const song of cat.songs ?? []) oldSongs.set(song.videoId, song);

  const skipped = [];
  let failed = false;
  const categories = [];
  for (const cat of config.categories) {
    const previous = existing.categories.find((c) => c.id === cat.id);
    if (args.only && cat.id !== args.only) {
      categories.push(previous ?? { ...cat, songs: [] });
      continue;
    }
    out(`== ${cat.id}: ${cat.title}`);
    try {
      const fresh = await collectSongs(cat, perCategory, skipped);
      const songs = fresh.map((s) => mergeWithExisting(s, oldSongs.get(s.videoId)));
      for (const s of songs) out(`  ${s.name} · ${s.artist || '—'} [${s.source}] ${describe(s)}`);
      if (songs.length < perCategory) {
        err(`  warning: only ${songs.length} of ${perCategory} playable songs in ${cat.id}`);
      }
      categories.push({ id: cat.id, title: cat.title, playlistId: cat.playlistId, songs });
    } catch (e) {
      failed = true;
      err(`  error: ${cat.id} failed (${e.message}); keeping the existing songs for it`);
      categories.push(previous ?? { ...cat, songs: [] });
    }
  }

  if (skipped.length > 0) {
    out('');
    out('Skipped:');
    for (const s of skipped) out(`  ${s.category} ${s.videoId} ${s.title ? `"${s.title}" ` : ''}— ${s.reason}`);
  }

  const catalog = { version: 1, generatedAt: today(), categories };
  if (args.dryRun) {
    out('');
    out('Dry run: catalog.json not written.');
  } else {
    await writeFile(CATALOG_FILE, `${JSON.stringify(catalog, null, 2)}\n`);
    out('');
    out(`Wrote ${path.relative(process.cwd(), CATALOG_FILE)} (${categories.reduce((n, c) => n + c.songs.length, 0)} songs)`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  err(`extract-segments: ${e.message}`);
  process.exit(1);
});
