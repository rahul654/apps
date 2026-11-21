import { useEffect, useMemo, useState } from 'react';
import { Field, Notice } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { ToolPage } from '../components/ToolPage';
import { ValueTable } from '../components/ValueTable';
import { useMemoryState } from '../hooks/memoryState';
import { TimeZoneSelect, useTimeZonePref } from '../components/TimeZoneSelect';
import { datetimeLocalValue, isoInZone, parseDatetimeLocal } from '../lib/time';
import { parseTimestamp, timestampRows, UNIT_LABEL, type TsUnit } from '../lib/timestamp';

function NowTicker() {
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [paused]);
  const s = String(Math.floor(now / 1000));
  return (
    <section className="card now-card" aria-labelledby="now-h">
      <div className="card-head">
        <h2 id="now-h" className="card-title">
          Now
        </h2>
        <button type="button" className="btn btn-sm" onClick={() => setPaused(!paused)} aria-pressed={paused}>
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
      </div>
      <div className="now-grid">
        <div>
          <span className="control-label">Unix seconds</span>
          <span className="now-value mono">{s}</span>
          <CopyButton text={s} ariaLabel="Copy current Unix seconds" />
        </div>
        <div>
          <span className="control-label">Unix milliseconds</span>
          <span className="now-value mono">{now}</span>
          <CopyButton text={String(now)} ariaLabel="Copy current Unix milliseconds" />
        </div>
        <div>
          <span className="control-label">ISO 8601 (UTC)</span>
          <span className="now-value mono small">{new Date(now).toISOString()}</span>
          <CopyButton text={new Date(now).toISOString()} ariaLabel="Copy current ISO time" />
        </div>
      </div>
    </section>
  );
}

export default function TimestampTool() {
  const [input, setInput] = useMemoryState('ts:input', '');
  const [unit, setUnit] = useState<TsUnit>('auto');
  const [tz, setTz] = useTimeZonePref('timestamp.tz');
  const [picker, setPicker] = useMemoryState('ts:picker', '');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const parsed = useMemo(() => (input.trim() ? parseTimestamp(input, unit) : null), [input, unit]);
  const pickerMs = picker ? parseDatetimeLocal(picker, tz) : null;

  return (
    <ToolPage title="Timestamp" icon={'⏱︎'} description="Convert Unix timestamps to dates and back, in any time zone.">
      <NowTicker />

      <section className="card" aria-labelledby="conv-h">
        <h2 id="conv-h" className="card-title">
          Convert a timestamp or date
        </h2>
        <div className="row">
          <Field label="Timestamp or date string" className="grow">
            {(id) => (
              <input
                id={id}
                className="mono"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="1700000000, 1700000000000, 2024-03-10T08:30:00Z…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={parsed ? !parsed.ok : undefined}
              />
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <select id={id} value={unit} onChange={(e) => setUnit(e.target.value as TsUnit)}>
                <option value="auto">Auto-detect</option>
                <option value="s">Seconds</option>
                <option value="ms">Milliseconds</option>
                <option value="us">Microseconds</option>
                <option value="ns">Nanoseconds</option>
              </select>
            )}
          </Field>
          <TimeZoneSelect value={tz} onChange={setTz} />
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-sm" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>
            Now
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInput('1700000000')}>
            Sample
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInput('')} disabled={!input}>
            Clear
          </button>
        </div>
        {parsed && !parsed.ok && <Notice kind="error">{parsed.error}</Notice>}
        {parsed?.ok && (
          <>
            <p className="muted small" aria-live="polite">
              Interpreted as {parsed.unit === 'date' ? 'a date string' : UNIT_LABEL[parsed.unit]}
              {unit === 'auto' && parsed.unit !== 'date' ? ' (auto-detected from the number of digits)' : ''}.
            </p>
            <ValueTable caption="Conversions" rows={timestampRows(parsed.ms, tz, now)} />
          </>
        )}
      </section>

      <section className="card" aria-labelledby="pick-h">
        <h2 id="pick-h" className="card-title">
          Date &amp; time → timestamp
        </h2>
        <div className="row">
          <Field label={`Date and time in ${tz}`} className="grow">
            {(id) => <input id={id} type="datetime-local" step={1} value={picker} onChange={(e) => setPicker(e.target.value)} />}
          </Field>
          <button type="button" className="btn" onClick={() => setPicker(datetimeLocalValue(Date.now(), tz))}>
            Now
          </button>
        </div>
        {pickerMs !== null && Number.isFinite(pickerMs) && (
          <ValueTable
            caption="Picked time"
            rows={[
              { label: 'Unix seconds', value: String(Math.floor(pickerMs / 1000)) },
              { label: 'Unix milliseconds', value: String(pickerMs) },
              { label: 'ISO 8601 (UTC)', value: new Date(pickerMs).toISOString() },
              { label: `ISO 8601 (${tz})`, value: isoInZone(pickerMs, tz) },
            ]}
          />
        )}
      </section>
    </ToolPage>
  );
}
