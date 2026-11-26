import { setFullSong } from '../store/player';

/** The per-song "Full song" override: beats the global mode for this song. */
export function FullSongSwitch({ videoId, name, on, label }: { videoId: string; name: string; on: boolean; label?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={on} aria-label={label ?? `Full song: ${name}`} onChange={(e) => setFullSong(videoId, e.currentTarget.checked)} />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">Full song</span>
    </label>
  );
}
