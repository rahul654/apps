import { useMemo } from 'react';
import { Field, Notice } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { TimeZoneSelect, useTimeZonePref } from '../components/TimeZoneSelect';
import { ToolPage } from '../components/ToolPage';
import { useMemoryState } from '../hooks/memoryState';
import { CronError, describeCron, type CronExpr, FIELD_SPECS, fieldValuesText, nextRuns, parseCron } from '../lib/cron';
import { humanInZone, isoInZone, relativeTime } from '../lib/time';

const PRESETS: { expr: string; label: string }[] = [
  { expr: '*/5 * * * *', label: 'Every 5 min' },
  { expr: '0 * * * *', label: 'Hourly' },
  { expr: '0 9 * * *', label: 'Daily 09:00' },
  { expr: '30 9 * * 1-5', label: 'Weekdays 09:30' },
  { expr: '0 0 1 * *', label: 'Monthly' },
  { expr: '0 0 1,15 * fri', label: 'DOM or DOW' },
  { expr: '@weekly', label: '@weekly' },
];

export default function CronTool() {
  const [expr, setExpr] = useMemoryState('cron:expr', '');
  const [tz, setTz] = useTimeZonePref('cron.tz');

  const result = useMemo((): { cron: CronExpr; description: string; runs: number[] } | { error: CronError } | null => {
    if (!expr.trim()) return null;
    try {
      const c = parseCron(expr);
      return { cron: c, description: describeCron(c), runs: nextRuns(c, Date.now(), 10, tz) };
    } catch (e) {
      return { error: e instanceof CronError ? e : new CronError(String(e)) };
    }
    // Re-evaluate when the zone changes; "now" is taken at evaluation time.
  }, [expr, tz]);
  const ok = result && 'cron' in result ? result : null;
  const now = Date.now();
  const fieldError = result && 'error' in result ? result.error.field : undefined;

  return (
    <ToolPage title="Cron explainer" icon="↻" description="Explain a standard 5-field cron expression and list its next run times.">
      <div className="row">
        <Field label="Cron expression" className="grow" hint="minute hour day-of-month month day-of-week · names (JAN, MON), lists, ranges, steps and @daily-style macros">
          {(id) => (
            <input
              id={id}
              className="mono cron-input"
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="*/15 9-17 * * mon-fri"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={result && !ok ? true : undefined}
            />
          )}
        </Field>
        <TimeZoneSelect value={tz} onChange={setTz} />
      </div>
      <div className="toolbar">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpr('*/15 9-17 * * mon-fri')}>
          Sample
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpr('')} disabled={!expr}>
          Clear
        </button>
      </div>
      <div className="examples" role="group" aria-labelledby="cron-examples-label">
        <span id="cron-examples-label" className="control-label">
          Examples
        </span>
        <div className="example-chips">
          {PRESETS.map((p) => (
            <button key={p.expr} type="button" className="btn btn-sm example-chip" onClick={() => setExpr(p.expr)} title={p.expr} aria-pressed={expr.trim() === p.expr}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {result && 'error' in result && <Notice kind="error">{result.error.message}</Notice>}

      {(ok || fieldError) && (
        <div className="cron-fields" aria-label="Fields">
          {FIELD_SPECS.map((spec, i) => {
            const f = ok?.cron[spec.name];
            const raw = (ok?.cron.expanded ?? expr.trim()).split(/\s+/)[i] ?? '';
            return (
              <div key={spec.name} className={`cron-field ${fieldError === spec.name ? 'is-invalid' : ''}`}>
                <code className="cron-field-src">{raw || '—'}</code>
                <span className="control-label">{spec.label}</span>
                {f && <span className="small muted">{fieldValuesText(f, spec.name)}</span>}
              </div>
            );
          })}
        </div>
      )}

      {ok && (
        <>
          <section className="card cron-desc" aria-live="polite">
            <p className="cron-sentence">“{ok.description}.”</p>
            {ok.cron.macro && (
              <p className="muted small">
                <code>{ok.cron.macro}</code> = <code>{ok.cron.expanded}</code>
              </p>
            )}
            {!ok.cron.dayOfMonth.full && !ok.cron.dayOfWeek.full && !ok.cron.dayOfMonth.startsWithStar && !ok.cron.dayOfWeek.startsWithStar && (
              <p className="muted small">Both day fields are set, so cron runs when <em>either</em> matches (OR), not both.</p>
            )}
          </section>
          <section className="card" aria-labelledby="runs-h">
            <div className="card-head">
              <h2 id="runs-h" className="card-title">
                Next {ok.runs.length} runs · {tz}
              </h2>
              <CopyButton text={() => ok.runs.map((t) => isoInZone(t, tz)).join('\n')} disabled={ok.runs.length === 0} label="Copy all" />
            </div>
            {ok.runs.length === 0 ? (
              <Notice kind="warn">This expression never matches a real date (for example 30 February).</Notice>
            ) : (
              <ol className="runs">
                {ok.runs.map((t) => (
                  <li key={t}>
                    <span>{humanInZone(t, tz)}</span>
                    <span className="mono small muted">{isoInZone(t, tz)}</span>
                    <span className="small muted">{relativeTime(t, now)}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="muted small">Times are evaluated on the wall clock of the selected zone. Local times skipped by a DST change don't run; a repeated hour runs once.</p>
          </section>
        </>
      )}
    </ToolPage>
  );
}
