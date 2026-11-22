import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { createStore, useStore } from '../store/createStore';
import { addText } from '../store/library';
import { toast } from '../store/toasts';
import { addFiles } from '../store/uploads';

const MAX_CHARS = 200_000; // the script's MAX_TEXT_CHARS

/** The unsent text, outside React: the box unmounts when the login ends, and the text must survive that. */
const draft = createStore('');

/**
 * The chat-style box at the bottom (signed in only): type or paste text and Send it as a text
 * item, or attach files. Pasting files or images (no text) uploads them.
 */
export function Composer() {
  const text = useStore(draft);
  const setText = draft.set;
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const tooLong = text.length > MAX_CHARS;

  // Grow with the text (browsers without CSS field-sizing, e.g. Safari); CSS caps it at 40vh.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || CSS.supports?.('field-sizing', 'content')) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = async () => {
    if (busy || !text.trim() || tooLong) return;
    setBusy(true);
    try {
      await addText(text);
      setText('');
      toast('Text saved.', 'ok');
    } catch (err) {
      if (!(err instanceof ApiError && err.isAuth)) toast(err instanceof ApiError ? err.message : 'Couldn’t save the text.', 'error');
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  };

  return (
    <div className="composer">
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files ?? []);
          e.target.value = '';
        }}
      />
      <button type="button" className="icon-btn attach" onClick={() => fileInput.current?.click()} aria-label="Upload files" title="Upload photos, videos or files">
        📎
      </button>
      <div className="composer-field">
        <textarea
          ref={area}
          value={text}
          rows={1}
          placeholder="Paste or type text to save…"
          aria-label="Text to save"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length && !e.clipboardData.getData('text/plain')) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          disabled={busy}
        />
        {text.length > MAX_CHARS * 0.9 && (
          <span className={`count tiny ${tooLong ? 'error' : 'muted'}`}>
            {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </span>
        )}
      </div>
      <button type="button" className="btn primary send" onClick={send} disabled={busy || !text.trim() || tooLong} title="Send (Ctrl+Enter)">
        {busy ? 'Saving…' : 'Send'}
      </button>
    </div>
  );
}
