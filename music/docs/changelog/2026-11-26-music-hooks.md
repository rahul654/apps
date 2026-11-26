# Music Hooks: play the most-replayed parts of YouTube playlists

New app `music/` (https://rahul654.github.io/apps/music/). It plays the most-replayed ("viral") part of each song from three YouTube playlists, one category per playlist, and any song can be switched to play in full. Pilot: 5 songs per category.

## Behaviour

- **Categories** (`scripts/playlists.json`): New Hindi Hits, English Pop, Retro Classics. Routes: `#/` shows all categories; `#/c/<id>` shows one. An unknown id shows a not-found message with a link home.
- **Modes:**
  - Hooks: each song's rank-1 clip.
  - All peaks: every clip of a song, in time order, then the next song.
  - Full song: whole songs.
- **Per-song "Full song" switch:** on each card and in the player. It overrides the mode for that song. Switching it during a clip keeps playing from the same second; switching back ends at the current clip, or jumps to the next one.
- **Clip chips:** a chip plays that clip, then playback continues in the song's mode.
- **Replay graph:** each card shows YouTube's replay curve with the clips shaded and a playhead.
- **Controls:** shuffle, repeat all, previous/next clip and song. Space plays/pauses; ←/→ move to the previous/next clip.
- **Public:** not behind the site password (`PUBLIC_APPS` in `gate/inject.mjs`).

## Data

- `src/data/catalog.json` is the single source; its shape is in `src/types.ts`. A song has 1–3 ranked segments (more only if hand-edited ones are kept) and its compact heatmap.
- `npm run extract` (`scripts/extract-segments.mjs`, needs `yt-dlp`, local only) regenerates it from the playlists. It skips private, non-embeddable and live videos.
  - It keeps hand-fixed `name`/`artist` and any segment marked `"edited": true`.
  - Flags: `--per-category N`, `--only <id>`, `--dry-run`.
- Peak finder: `scripts/lib/segments.mjs`. Constants are in `DEFAULTS`; the reasons are in `CLAUDE.md` "Music".
  - The play-button spike at 0–2 s and its falling tail are ignored.
  - Clips are 20–45 s. A clip grows while the curve stays at 85% or more of its peak; the curves are flat, so 60% made every clip 45 s.
  - Songs without replay data get one guessed 30 s clip (`source: "fallback"`).
- Phase 2 (Google Sheet / Apps Script): replace only `loadCatalog()` in `src/lib/catalog.ts`. The page already handles loading and error states. The schema maps to one sheet row per segment.

## Code

- `src/lib/playback.ts` (pure): `clipsFor`, the queue/navigation logic, and `afterToggle` (`continue` / `seek` / `next-song`).
- `src/lib/youtube.ts`: loads the IFrame API once. `loadVideoById` gets no `endSeconds`; clip ends come from a 250 ms time poll, which is what lets a song switch to full mid-clip. The next clip in the same video uses `seekTo`.
- `src/store/player.ts`: player state outside React, so changing pages doesn't stop playback.
- `src/lib/prefs.ts`: `music:prefs:v1` stores the mode, full-song ids, shuffle and repeat.

## Gotchas

- **Skipped from the pilot:** two Retro picks (Lag Jaa Gale `TFr6G5zveS8`, Mere Sapno Ki Rani `UlWAjd9bcKw`) block embedding, and New Hindi's first entry (`kxfzckNQGZc`) is private. The script took the next songs in the playlist instead.
- Pehla Nasha has no replay data on YouTube, so it uses a fallback clip.
- On phones, YouTube stops when the screen locks or the tab goes to the background. This is a limit of the embed.
- The first play needs a tap, because browsers block autoplay.
- `google.com/pagead/…` CORS errors in the console come from YouTube's iframe.

## History

- 2026-11-26: First version: 3 categories × 5 songs, Hooks / All peaks / Full song modes, per-song Full song switch, replay graphs, public app.
