import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { IconUpload } from './Icons';

interface Props {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  label: string;
  hint?: string;
  /** Also accept images pasted with Ctrl/⌘+V while this zone is mounted. */
  paste?: boolean;
  compact?: boolean;
  /** Return false to reject a file. */
  filter?: (f: File) => boolean;
  /** Called with the names of rejected files (the parent shows the message, so it survives re-layouts). */
  onReject?: (names: string[]) => void;
}

/** Drag-and-drop + click-to-pick + paste, keyboard accessible. */
export function DropZone({ accept, multiple = true, onFiles, label, hint, paste = false, compact = false, filter, onReject }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const onRejectRef = useRef(onReject);
  onRejectRef.current = onReject;

  const handle = (list: FileList | File[] | null) => {
    if (!list) return;
    let files = Array.from(list);
    if (!multiple) files = files.slice(0, 1);
    const ok = filterRef.current ? files.filter(filterRef.current) : files;
    onRejectRef.current?.(files.filter((f) => !ok.includes(f)).map((f) => f.name || 'pasted file'));
    if (ok.length) onFilesRef.current(ok);
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    if (!paste) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      // Pasted screenshots are usually all called "image.png"; give them distinct names.
      handleRef.current(files.map((f, i) => (f.name === 'image.png' || !f.name ? new File([f], `pasted-${Date.now()}${i ? `-${i}` : ''}.png`, { type: f.type }) : f)));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [paste]);

  const open = () => inputRef.current?.click();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files);
  };

  return (
    <div className="stack-sm">
      <div
        className={`dropzone${over ? ' over' : ''}${compact ? ' compact' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-describedby={hint || paste ? hintId : undefined}
        onClick={open}
        onKeyDown={onKey}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!over) setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
        }}
        onDrop={onDrop}
      >
        <span className="dz-icon" aria-hidden="true">
          <IconUpload size={compact ? 18 : 26} />
        </span>
        <strong>{label}</strong>
        {(hint || paste) && (
          <span id={hintId} className="muted small">
            {hint}
            {paste ? `${hint ? ' · ' : ''}or paste with Ctrl/⌘+V` : ''}
          </span>
        )}
      </div>
      {/* Kept outside the zone: inputRef.click() inside it would bubble to the zone's onClick and open the picker twice. */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
