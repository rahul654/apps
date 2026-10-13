import { useCallback, useEffect, useMemo, useState } from 'react';
import { CodeArea } from '../components/CodeArea';
import { Checkbox, Field, Notice, Segmented, Toolbar } from '../components/Controls';
import { ToolPage } from '../components/ToolPage';
import { ValueTable } from '../components/ValueTable';
import { useMemoryState } from '../hooks/memoryState';
import { oneOf, usePref } from '../hooks/prefs';
import { formatUuid, inspectUuid, uuidv4, uuidv7 } from '../lib/uuid';

const MAX = 10_000;

export default function UuidTool() {
  const [version, setVersion] = usePref<'v4' | 'v7'>('uuid.version', 'v4', oneOf('v4', 'v7'));
  const [count, setCount] = usePref<number>('uuid.count', 5, (v) => typeof v === 'number' && v >= 1 && v <= MAX);
  const [uppercase, setUppercase] = usePref('uuid.upper', false, oneOf(true, false));
  const [hyphens, setHyphens] = usePref('uuid.hyphens', true, oneOf(true, false));
  const [ids, setIds] = useState<string[]>([]);
  const [check, setCheck] = useMemoryState('uuid:check', '');

  const generate = useCallback(() => {
    const gen = version === 'v4' ? () => uuidv4() : uuidv7;
    setIds(Array.from({ length: Math.min(Math.max(1, count), MAX) }, gen));
  }, [version, count]);

  useEffect(generate, [generate]);

  const output = useMemo(() => ids.map((u) => formatUuid(u, { uppercase, hyphens })).join('\n'), [ids, uppercase, hyphens]);
  const info = check.trim() ? inspectUuid(check) : undefined;

  return (
    <ToolPage title="UUID / ID generator" icon="ID" description="Generate random (v4) or time-ordered (v7) UUIDs, and inspect any UUID.">
      <section className="card" aria-labelledby="gen-h">
        <h2 id="gen-h" className="card-title">
          Generate
        </h2>
        <Toolbar>
          <Segmented
            label="Version"
            value={version}
            onChange={setVersion}
            options={[
              { value: 'v4', label: 'v4 · random' },
              { value: 'v7', label: 'v7 · time-ordered' },
            ]}
          />
          <Field label="How many">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={MAX}
                value={count}
                className="count-input"
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (Number.isFinite(n)) setCount(Math.min(MAX, Math.max(1, n)));
                }}
              />
            )}
          </Field>
          <Checkbox label="Uppercase" checked={uppercase} onChange={setUppercase} />
          <Checkbox label="Hyphens" checked={hyphens} onChange={setHyphens} />
          <button type="button" className="btn btn-primary" onClick={generate}>
            ↻ Generate
          </button>
        </Toolbar>
        <CodeArea label={`${ids.length} UUID${ids.length === 1 ? '' : 's'} (${version})`} value={output} rows={Math.min(12, Math.max(3, ids.length))} />
        {version === 'v7' && <p className="muted small">v7 IDs embed the creation time (Unix ms) and sort in creation order, which keeps database indexes compact.</p>}
      </section>

      <section className="card" aria-labelledby="val-h">
        <h2 id="val-h" className="card-title">
          Validate &amp; inspect
        </h2>
        <Field label="UUID">
          {(id) => (
            <div className="input-with-btn">
              <input id={id} className="mono" value={check} onChange={(e) => setCheck(e.target.value)} placeholder="e.g. 018f…-7…" spellCheck={false} autoComplete="off" aria-invalid={info === null ? true : undefined} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCheck(ids[0] ?? uuidv7())}>
                Sample
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCheck('')} disabled={!check}>
                Clear
              </button>
            </div>
          )}
        </Field>
        {info === null && <Notice kind="error">Not a valid UUID (expected 32 hex digits, optionally as 8-4-4-4-12 with hyphens, braces or urn:uuid:).</Notice>}
        {info && (
          <>
            <Notice kind="ok">Valid UUID</Notice>
            <ValueTable
              caption="UUID details"
              rows={[
                { label: 'Normalized', value: info.normalized },
                { label: 'Version', value: info.special ? info.versionName : `${info.version} — ${info.versionName}` },
                { label: 'Variant', value: info.variant },
                ...(info.timestampMs !== undefined ? [{ label: 'Embedded time (UTC)', value: Number.isFinite(new Date(info.timestampMs).getTime()) ? new Date(info.timestampMs).toISOString() : String(info.timestampMs) }] : []),
                ...(info.timestampMs !== undefined ? [{ label: 'Embedded time (Unix ms)', value: String(info.timestampMs) }] : []),
              ]}
            />
          </>
        )}
      </section>
    </ToolPage>
  );
}
