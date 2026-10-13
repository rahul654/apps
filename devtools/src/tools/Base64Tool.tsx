import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CodeArea } from '../components/CodeArea';
import { Checkbox, Field, Notice, Segmented, Toolbar } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { FileDrop } from '../components/FileDrop';
import { ToolPage } from '../components/ToolPage';
import { useMemoryState } from '../hooks/memoryState';
import { oneOf, usePref } from '../hooks/prefs';
import { sizeDelay, useDebounced } from '../hooks/useDebounced';
import { base64ToBytes, bytesToBase64, decodeBase64Text, encodeTextBase64, extensionForMime, hexPreview, parseDataUrl, sniffMime } from '../lib/base64';
import { downloadBlob, formatBytes } from '../lib/clipboard';

const PREVIEW_LIMIT = 1_000_000; // characters shown in a textarea; Copy/Download still use the full value

function TextMode() {
  const [dir, setDir] = usePref<'encode' | 'decode'>('base64.dir', 'encode', oneOf('encode', 'decode'));
  const [urlSafe, setUrlSafe] = usePref('base64.urlSafe', false, oneOf(true, false));
  const [input, setInput] = useMemoryState('base64:text', '');
  const debounced = useDebounced(input, sizeDelay(input.length));

  const result = useMemo(() => {
    if (debounced === '') return { output: '' };
    try {
      if (dir === 'encode') return { output: encodeTextBase64(debounced, urlSafe) };
      const { text, bytes } = decodeBase64Text(debounced);
      return text === null ? { output: '', binary: bytes } : { output: text };
    } catch (e) {
      return { output: '', error: e instanceof Error ? e.message : String(e) };
    }
  }, [debounced, dir, urlSafe]);

  const swap = () => {
    setInput(result.output);
    setDir(dir === 'encode' ? 'decode' : 'encode');
  };

  return (
    <>
      <Toolbar>
        <Segmented
          label="Direction"
          value={dir}
          onChange={setDir}
          options={[
            { value: 'encode', label: 'Encode' },
            { value: 'decode', label: 'Decode' },
          ]}
        />
        {dir === 'encode' && <Checkbox label="URL-safe (−_ and no padding)" checked={urlSafe} onChange={setUrlSafe} />}
        <button type="button" className="btn" onClick={swap} disabled={!result.output}>
          ⇄ Use output as input
        </button>
      </Toolbar>
      {result.error && <Notice kind="error">{result.error}</Notice>}
      <div className="panes">
        <CodeArea
          label={dir === 'encode' ? 'Text' : 'Base64'}
          value={input}
          onChange={setInput}
          onSample={() => setInput(dir === 'encode' ? 'Hello, wörld! 👋 Ünïcödé is fine.' : 'SGVsbG8sIHfDtnJsZCEg8J+RiyDDnG7Dr2PDtmTDqSBpcyBmaW5lLg==')}
          onClear={() => setInput('')}
          placeholder={dir === 'encode' ? 'Text to encode…' : 'Base64 or data URL to decode (standard or URL-safe)…'}
          invalid={!!result.error}
        />
        {result.binary ? (
          <div className="code-area">
            <div className="code-area-head">
              <span className="control-label">Decoded (binary)</span>
            </div>
            <BinaryResult bytes={result.binary} />
          </div>
        ) : (
          <CodeArea label={dir === 'encode' ? 'Base64' : 'Text'} value={result.output} />
        )}
      </div>
      {dir === 'decode' && <p className="muted small">Accepts standard and URL-safe alphabets, missing padding, whitespace and data URLs. Text is decoded as UTF-8.</p>}
    </>
  );
}

function BinaryResult({ bytes, mimeHint }: { bytes: Uint8Array<ArrayBuffer>; mimeHint?: string }) {
  const sniffed = sniffMime(bytes);
  const mime = mimeHint || sniffed?.mime || 'application/octet-stream';
  const [name, setName] = useState('');
  const filename = name || `decoded.${sniffed?.ext ?? extensionForMime(mime)}`;
  const isImage = mime.startsWith('image/');
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, mime, isImage]);
  return (
    <div className="binary-result">
      <p>
        <strong>{formatBytes(bytes.length)}</strong> of binary data · detected type <code>{mime}</code>
      </p>
      <p className="mono small hex-preview">{hexPreview(bytes)}</p>
      {url && <img className="preview-img" src={url} alt="Decoded image preview" />}
      <div className="row">
        <Field label="File name">{(id) => <input id={id} value={name} placeholder={filename} onChange={(e) => setName(e.target.value)} />}</Field>
        <button type="button" className="btn btn-primary" onClick={() => downloadBlob(bytes, filename, mime)}>
          Download file
        </button>
      </div>
    </div>
  );
}

function FileMode() {
  const [file, setFile] = useState<File | null>(null);
  const [encoded, setEncoded] = useState<{ b64: string; mime: string; url: string | null } | null>(null);
  const [readError, setReadError] = useState('');
  const [decodeInput, setDecodeInput] = useMemoryState('base64:fileDecode', '');
  const debouncedDecode = useDebounced(decodeInput, sizeDelay(decodeInput.length));

  useEffect(() => {
    setEncoded(null);
    setReadError('');
    if (!file) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    file.arrayBuffer().then(
      (buf) => {
        if (cancelled) return;
        const bytes = new Uint8Array(buf);
        const mime = file.type || sniffMime(bytes)?.mime || 'application/octet-stream';
        objectUrl = mime.startsWith('image/') ? URL.createObjectURL(file) : null;
        setEncoded({ b64: bytesToBase64(bytes), mime, url: objectUrl });
      },
      (e: Error) => !cancelled && setReadError(e.message),
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const decoded = useMemo(() => {
    if (!debouncedDecode.trim()) return null;
    try {
      const d = parseDataUrl(debouncedDecode);
      const bytes = base64ToBytes(d?.isBase64 ? d.data : debouncedDecode);
      return { bytes, mime: d?.mime };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [debouncedDecode]);

  const dataUrl = encoded ? `data:${encoded.mime};base64,${encoded.b64}` : '';
  const tooBig = dataUrl.length > PREVIEW_LIMIT;

  return (
    <>
      <section className="card" aria-labelledby="enc-h">
        <h2 id="enc-h" className="card-title">
          Encode a file
        </h2>
        <FileDrop label="Choose file…" file={file} onFile={setFile} />
        {readError && <Notice kind="error">{readError}</Notice>}
        {encoded && (
          <>
            {encoded.url && <img className="preview-img" src={encoded.url} alt={`Preview of ${file?.name}`} />}
            {tooBig && <Notice kind="info">Output is large ({formatBytes(dataUrl.length)}); the boxes show a preview. Copy and Download use the full value.</Notice>}
            <div className="panes">
              <CodeArea
                label="Data URL"
                value={tooBig ? `${dataUrl.slice(0, PREVIEW_LIMIT)}…` : dataUrl}
                copy={false}
                rows={6}
                actions={<CopyButton text={dataUrl} ariaLabel="Copy data URL" />}
              />
              <CodeArea
                label="Base64"
                value={tooBig ? `${encoded.b64.slice(0, PREVIEW_LIMIT)}…` : encoded.b64}
                copy={false}
                rows={6}
                actions={
                  <>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadBlob(encoded.b64, `${file?.name ?? 'file'}.b64.txt`, 'text/plain')}>
                      Download
                    </button>
                    <CopyButton text={encoded.b64} ariaLabel="Copy base64" />
                  </>
                }
              />
            </div>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="dec-h">
        <h2 id="dec-h" className="card-title">
          Decode to a file
        </h2>
        <CodeArea
          label="Base64 or data URL"
          value={decodeInput}
          onChange={setDecodeInput}
          onClear={() => setDecodeInput('')}
          onSample={() =>
            setDecodeInput(
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAK0lEQVR4nGPwd3v6HxmjA0LyDMPAAFI1oMsPBwMGPhYG3gBSNQzCaKTUAACOojquv3DnAgAAAABJRU5ErkJggg==',
            )
          }
          rows={6}
          placeholder="Paste base64 or a data: URL…"
          invalid={!!decoded && 'error' in decoded}
        />
        {decoded && 'error' in decoded && <Notice kind="error">{decoded.error}</Notice>}
        {decoded && 'bytes' in decoded && decoded.bytes && <BinaryResult bytes={decoded.bytes} mimeHint={decoded.mime} />}
      </section>
    </>
  );
}

export default function Base64Tool() {
  const mode = useParams()['*'];
  return (
    <ToolPage
      title="Base64"
      icon="64"
      description="Encode and decode Base64 text (UTF-8 safe) and convert files to and from Base64 / data URLs."
      tabs={[
        { to: '/base64', label: 'Text' },
        { to: '/base64/file', label: 'File' },
      ]}
    >
      {mode === 'file' ? <FileMode /> : <TextMode />}
    </ToolPage>
  );
}
