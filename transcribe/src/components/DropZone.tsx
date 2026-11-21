import { useId, useRef, useState } from 'react';
import { IconUpload } from './Icons';

/**
 * File picker + drop target. The hidden <input type=file> sits outside the clickable zone:
 * a programmatic click() inside it would bubble back to the zone's onClick.
 */
export function DropZone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hint = useId();
  return (
    <>
      <div
        className={over ? 'dropzone over' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f && !disabled) onFile(f);
        }}
      >
        <IconUpload size={28} />
        <button type="button" className="btn primary" onClick={() => input.current?.click()} disabled={disabled} aria-describedby={hint}>
          Choose audio or video file
        </button>
        <p id={hint} className="muted small">
          or drop it here. MP3, WAV, M4A, OGG, FLAC, WebM, MP4, MOV…
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,.mp4,.mov,.mkv"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}
