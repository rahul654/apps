import { memo } from 'react';
import { formatClip, formatTime, type Clip } from '../lib/playback';
import { playFrom, togglePlay, type QueueItem } from '../store/player';
import type { Segment } from '../types';
import { FullSongSwitch } from './FullSongSwitch';
import { PauseIcon, PlayIcon } from './Icons';
import { ReplayGraph } from './ReplayGraph';

export interface SongCardProps {
  items: readonly QueueItem[];
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isFull: boolean;
  /** The clip being played, when this is the current song. */
  activeClip: Clip | null;
  /** Why the player can't play this song, if it refused it. */
  unavailable: string | null;
}

function chipActive(seg: Segment, clip: Clip | null): boolean {
  return !!clip && seg.start >= clip.start && seg.end <= clip.end;
}

export const SongCard = memo(function SongCard({ items, index, isCurrent, isPlaying, isFull, activeClip, unavailable }: SongCardProps) {
  const { song } = items[index];
  const label = isCurrent && isPlaying ? `Pause ${song.name}` : `Play ${song.name}`;
  const partial = activeClip && !(activeClip.start === 0 && activeClip.end === song.duration) ? activeClip : null;
  return (
    <li className={`song${isCurrent ? ' current' : ''}${unavailable ? ' unavailable' : ''}`} aria-current={isCurrent ? 'true' : undefined}>
      <div className="thumb-wrap">
        <img className="thumb" src={`https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`} alt="" loading="lazy" width={320} height={180} />
        <button
          type="button"
          className="thumb-play"
          aria-label={label}
          disabled={!!unavailable}
          onClick={() => (isCurrent ? togglePlay() : playFrom(items, index))}
        >
          {isCurrent && isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
      </div>
      <div className="song-body">
        <div className="song-head">
          <div className="grow">
            <h3 className="song-name">{song.name}</h3>
            {song.artist && <p className="song-artist">{song.artist}</p>}
          </div>
          <span className="song-duration tiny muted">{formatTime(song.duration)}</span>
        </div>
        {unavailable ? (
          <p className="song-note warn">Can’t play here: {unavailable}. Skipped.</p>
        ) : song.source === 'fallback' ? (
          <p className="song-note">No replay data — guessed clip</p>
        ) : (
          <ReplayGraph song={song} showPlayhead={isCurrent} />
        )}
        <div className="song-foot">
          <ul className="chips" aria-label={`Clips of ${song.name}`}>
            {song.segments.map((seg) => (
              <li key={seg.rank}>
                <button
                  type="button"
                  className={`chip${isCurrent && chipActive(seg, partial) ? ' active' : ''}`}
                  disabled={!!unavailable}
                  aria-label={`Play ${song.name} from ${formatTime(seg.start)} to ${formatTime(seg.end)}${seg.rank === 1 ? ', most replayed' : ''}`}
                  onClick={() => playFrom(items, index, seg)}
                >
                  {seg.rank === 1 && <span className="rank">★1</span>}
                  {formatClip(seg)}
                </button>
              </li>
            ))}
          </ul>
          <FullSongSwitch videoId={song.videoId} name={song.name} on={isFull} />
        </div>
      </div>
    </li>
  );
});
