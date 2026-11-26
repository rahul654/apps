import { useEffect, useRef } from 'react';
import { formatClip, formatTime, type Clip, type Mode } from '../lib/playback';
import {
  attachPlayer,
  canGoNext,
  currentItem,
  next,
  nextSongAction,
  prev,
  prevSongAction,
  setMode,
  toggleRepeat,
  togglePlay,
  toggleShuffle,
  usePlayer,
  useTime,
} from '../store/player';
import { FullSongSwitch } from './FullSongSwitch';
import { NextClipIcon, NextSongIcon, PauseIcon, PlayIcon, PrevClipIcon, PrevSongIcon, RepeatIcon, ShuffleIcon } from './Icons';

const MODE_LABELS: Record<Mode, string> = { hooks: 'Hooks', peaks: 'All peaks', full: 'Full song' };

function ClipProgress({ clip }: { clip: Clip }) {
  const t = useTime();
  const len = Math.max(1, clip.end - clip.start);
  const pct = Math.min(100, Math.max(0, ((t - clip.start) / len) * 100));
  return (
    <div className="progress-wrap">
      <div className="progress" role="progressbar" aria-label="Clip progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="row between tiny muted">
        <span className="mono">{formatTime(t)}</span>
        <span className="mono" data-testid="clip-range">
          {formatClip(clip)}
        </span>
      </div>
    </div>
  );
}

export function PlayerPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const s = usePlayer();
  const item = currentItem(s);
  const playing = s.status === 'playing' || s.status === 'loading';

  useEffect(() => attachPlayer(hostRef.current!), []);

  return (
    <section className="player" aria-label="Player">
      <div className="video-box">
        <div ref={hostRef} className="video-host" />
        {s.player === 'error' ? (
          <div className="video-msg">
            <p>{s.playerError}</p>
          </div>
        ) : (
          !item && (
            <div className="video-msg" aria-hidden="true">
              <p>Pick a song, or press play to start this page.</p>
            </div>
          )
        )}
      </div>

      <div className="now">
        {item ? (
          <>
            <p className="now-name">{item.song.name}</p>
            <p className="now-artist muted small">{item.song.artist || ' '}</p>
          </>
        ) : (
          <>
            <p className="now-name muted">Nothing playing</p>
            <p className="now-artist muted small">{s.view.length} songs on this page</p>
          </>
        )}
        {s.status === 'ended' && <p className="tiny muted">End of the list.{s.prefs.repeat ? '' : ' Turn on repeat to keep going.'}</p>}
      </div>

      {s.clip && <ClipProgress clip={s.clip} />}

      <div className="controls">
        <button type="button" className="icon-btn" aria-label="Previous song" onClick={prevSongAction} disabled={!item}>
          <PrevSongIcon />
        </button>
        <button type="button" className="icon-btn" aria-label="Previous clip" onClick={prev} disabled={!item}>
          <PrevClipIcon />
        </button>
        <button type="button" className="icon-btn big" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay} disabled={!item && s.view.length === 0}>
          {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </button>
        <button type="button" className="icon-btn" aria-label="Next clip" onClick={next} disabled={!canGoNext(s)}>
          <NextClipIcon />
        </button>
        <button type="button" className="icon-btn" aria-label="Next song" onClick={nextSongAction} disabled={!canGoNext(s)}>
          <NextSongIcon />
        </button>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Play mode">
        {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
          <label key={m} className={s.prefs.mode === m ? 'on' : undefined}>
            <input type="radio" name="mode" value={m} checked={s.prefs.mode === m} onChange={() => setMode(m)} />
            {MODE_LABELS[m]}
          </label>
        ))}
      </div>

      <div className="row wrap between">
        <div className="row">
          <button type="button" className="icon-btn toggle" aria-label="Shuffle" aria-pressed={s.prefs.shuffle} onClick={toggleShuffle}>
            <ShuffleIcon />
          </button>
          <button type="button" className="icon-btn toggle" aria-label="Repeat all" aria-pressed={s.prefs.repeat} onClick={toggleRepeat}>
            <RepeatIcon />
          </button>
        </div>
        {item && <FullSongSwitch videoId={item.song.videoId} name={item.song.name} on={s.fullSet.has(item.song.videoId)} label={`Play ${item.song.name} in full (now playing)`} />}
      </div>
      <p className="tiny muted keys">Space play/pause · ← → previous/next clip</p>
    </section>
  );
}
