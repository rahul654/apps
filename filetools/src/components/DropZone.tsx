import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { formatBytes, LARGE_FILE_BYTES } from '../lib/format';
import { Notice } from './Feedback';

interface Props {
  /** `accept` attribute for the file picker, e.g. "image/*" or "application/pdf,.pdf". */
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  label?: string;
  hint?: string;
  /** Also accept files pasted from the clipboard (Ctrl/Cmd+V) while this zone is on screen. */
  paste?: boolean;
  compact?: boolean;
  disabled?: boolean;
  /** Filter dropped files; return false to reject (they're reported to the user). */
  filter?: (f: File) => boolean;
}

/** Drag-and-drop + click-to-pick + paste file input, keyboard accessible. */
export function DropZone({ accept, multiple = true, onFiles, label, hint, paste = false, compact = false, disabled = false, filter }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [pendingLarge, setPendingLarge] = useState<{ ok: File[]; large: File[] } | null>(null);
  const hintId = useId();
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  const accepts = (f: File) => {
    if (filter) return filter(f);
    const rules = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (rules.length === 0) return true;
    const name = f.name.toLowerCase();
    const type = (f.type || '').toLowerCase();
    return rules.some((r) => (r.startsWith('.') ? name.endsWith(r) : r.endsWith('/*') ? type.startsWith(r.slice(0, -1)) : type === r));
  };

  const handle = (list: FileList | File[] | null) => {
    if (!list || disabled) return;
    let files = Array.from(list);
    if (!multiple) files = files.slice(0, 1);
    const ok = files.filter(accepts);
    setRejected(files.filter((f) => !accepts(f)).map((f) => f.name || 'pasted file'));
    const large = ok.filter((f) => f.size > LARGE_FILE_BYTES);
    if (large.length) {
      setPendingLarge({ ok: ok.filter((f) => f.size <= LARGE_FILE_BYTES), large });
      return;
    }
    if (ok.length) onFilesRef.current(ok);
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    if (!paste || disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        // Pasted screenshots are often named "image.png"; give them a clearer name.
        handleRef.current(files.map((f, i) => (f.name === 'image.png' ? new File([f], `pasted-${Date.now()}${i ? `-${i}` : ''}.png`, { type: f.type }) : f)));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [paste, disabled]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files);
  };
  const open = () => !disabled && inputRef.current?.click();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  const title = label ?? (multiple ? 'Drop files here or click to choose' : 'Drop a file here or click to choose');
  return (
    <div className="stack-sm">
      <div
        className={`dropzone${over ? ' over' : ''}${compact ? ' compact' : ''}${disabled ? ' disabled' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={title}
        aria-describedby={hintId}
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
        <span className="dz-icon" aria-hidden="true">📂</span>
        <strong>{title}</strong>
        <span id={hintId} className="muted small">
          {hint}
          {paste ? `${hint ? ' · ' : ''}or paste with Ctrl/⌘+V` : ''}
        </span>
      </div>
      {/* Kept outside the zone: inputRef.click() inside it bubbles to the zone's onClick and opens the picker twice. */}
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
      {rejected.length > 0 && (
        <Notice kind="warn" onDismiss={() => setRejected([])}>
          Skipped {rejected.length} unsupported file{rejected.length > 1 ? 's' : ''}: {rejected.slice(0, 5).join(', ')}
          {rejected.length > 5 ? '…' : ''}
        </Notice>
      )}
      {pendingLarge && (
        <Notice kind="warn">
          <strong>Very large file{pendingLarge.large.length > 1 ? 's' : ''}:</strong>{' '}
          {pendingLarge.large.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ')}. Processing files over {formatBytes(LARGE_FILE_BYTES)} in the browser can run out of memory and crash the tab.
          <div className="row">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const all = [...pendingLarge.ok, ...pendingLarge.large];
                setPendingLarge(null);
                if (all.length) onFilesRef.current(all);
              }}
            >
              Add anyway
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const ok = pendingLarge.ok;
                setPendingLarge(null);
                if (ok.length) onFilesRef.current(ok);
              }}
            >
              Skip large file{pendingLarge.large.length > 1 ? 's' : ''}
            </button>
          </div>
        </Notice>
      )}
    </div>
  );
}
