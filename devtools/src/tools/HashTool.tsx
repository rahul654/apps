import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CodeArea } from '../components/CodeArea';
import { Checkbox, Field, Notice, Segmented, Toolbar } from '../components/Controls';
import { FileDrop } from '../components/FileDrop';
import { ToolPage } from '../components/ToolPage';
import { ValueTable } from '../components/ValueTable';
import { useMemoryState } from '../hooks/memoryState';
import { oneOf, usePref } from '../hooks/prefs';
import { useCompute } from '../hooks/useCompute';
import { sizeDelay } from '../hooks/useDebounced';
import type { HashReq } from '../workers/protocol';

export default function HashTool() {
  const mode = useParams()['*'] === 'file' ? 'file' : 'text';
  const [text, setText] = useMemoryState('hash:text', '');
  const [file, setFile] = useState<File | null>(null);
  const [useHmac, setUseHmac] = useMemoryState('hash:useHmac', false);
  const [key, setKey] = useMemoryState('hash:key', '');
  const [keyEnc, setKeyEnc] = useState<'utf8' | 'hex'>('utf8');
  const [enc, setEnc] = usePref<'hex' | 'base64'>('hash.encoding', 'hex', oneOf('hex', 'base64'));
  const [upper, setUpper] = usePref('hash.upper', false, oneOf(true, false));
  const [compare, setCompare] = useMemoryState('hash:compare', '');

  const payload = useMemo<HashReq | null>(() => {
    const hmacKey = useHmac ? { value: key, encoding: keyEnc } : undefined;
    if (mode === 'file') return file ? { file, hmacKey } : null;
    return text === '' ? null : { text, hmacKey };
  }, [mode, file, text, useHmac, key, keyEnc]);
  const { result, error, busy } = useCompute('hash', payload, { delay: mode === 'file' ? 0 : Math.max(60, sizeDelay(text.length)) });

  const cmp = compare.trim().toLowerCase();
  const rows = (result ?? []).map((r) => {
    const value = enc === 'hex' ? (upper ? r.hex.toUpperCase() : r.hex) : r.base64;
    const match = cmp !== '' && (r.hex === cmp || r.base64.toLowerCase() === cmp);
    return { label: useHmac ? `HMAC-${r.alg}` : r.alg, value, highlight: match, extra: match ? <span className="badge badge-add match-badge">✓ matches</span> : undefined };
  });
  const anyMatch = rows.some((r) => r.highlight);

  return (
    <ToolPage
      title="Hash"
      icon="#"
      description="Compute MD5, SHA-1, SHA-256, SHA-384 and SHA-512 digests or HMACs of text or files."
      tabs={[
        { to: '/hash', label: 'Text' },
        { to: '/hash/file', label: 'File' },
      ]}
    >
      {mode === 'text' ? (
        <CodeArea label="Text (UTF-8)" value={text} onChange={setText} onSample={() => setText('The quick brown fox jumps over the lazy dog')} onClear={() => setText('')} rows={6} placeholder="Text to hash…" />
      ) : (
        <FileDrop label="Choose file…" file={file} onFile={setFile} />
      )}

      <Toolbar>
        <Segmented
          label="Output"
          value={enc}
          onChange={setEnc}
          options={[
            { value: 'hex', label: 'Hex' },
            { value: 'base64', label: 'Base64' },
          ]}
        />
        {enc === 'hex' && <Checkbox label="Uppercase" checked={upper} onChange={setUpper} />}
        <Checkbox label="HMAC" checked={useHmac} onChange={setUseHmac} />
      </Toolbar>
      {useHmac && (
        <div className="row">
          <Field label="HMAC key" className="grow">
            {(id) => <input id={id} className="mono" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" placeholder="secret key" />}
          </Field>
          <Field label="Key format">
            {(id) => (
              <select id={id} value={keyEnc} onChange={(e) => setKeyEnc(e.target.value as 'utf8' | 'hex')}>
                <option value="utf8">UTF-8 text</option>
                <option value="hex">Hex bytes</option>
              </select>
            )}
          </Field>
        </div>
      )}

      <div aria-live="polite">
        {busy && <p className="muted">{mode === 'file' ? 'Hashing file…' : 'Hashing…'}</p>}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      {result && !busy && (
        <section className="card" aria-label="Digests">
          <ValueTable caption="Digests" rows={rows} />
        </section>
      )}
      <Field label="Compare with an expected hash (hex or base64)" hint={cmp ? (anyMatch ? 'Match found ✓' : 'No algorithm matches this value') : undefined}>
        {(id) => <input id={id} className="mono" value={compare} onChange={(e) => setCompare(e.target.value)} spellCheck={false} autoComplete="off" placeholder="Paste a checksum to verify…" />}
      </Field>
      <p className="muted small">MD5 and SHA-1 are broken for security purposes; use them only for checksums. SHA digests use the browser's WebCrypto; MD5 is computed locally.</p>
    </ToolPage>
  );
}
