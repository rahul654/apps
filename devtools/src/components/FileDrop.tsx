import { useId, useState, type DragEvent } from 'react';
import { formatBytes } from '../lib/clipboard';

interface Props {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
  accept?: string;
}

/** File picker with drag & drop. Files are only read locally. */
export function FileDrop({ label, file, onFile, accept }: Props) {
  const id = useId();
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  return (
    <div
      className={`file-drop ${over ? 'is-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input id={id} type="file" className="sr-only" accept={accept} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <label htmlFor={id} className="btn">
        {label}
      </label>
      <span className="muted">or drop a file here</span>
      {file && (
        <span className="file-meta">
          <strong>{file.name}</strong> · {formatBytes(file.size)}
          {file.type ? ` · ${file.type}` : ''}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onFile(null)}>
            Remove
          </button>
        </span>
      )}
    </div>
  );
}
