import { useEffect, useState } from 'react';
import { formatBytes, formatDuration } from '../lib/format';
import { bySizeAscending } from '../lib/upload';
import { openLogin } from '../store/auth';
import { useStore } from '../store/createStore';
import { cancelJob, clearFinished, MAX_PARALLEL, resume, retryJob, uploads, type Job } from '../store/uploads';

const ACTIVE = new Set(['uploading', 'paused']);
const FINISHED = new Set(['done', 'failed', 'skipped']);

/** Rows in the order they run: current, then queued smallest-first, then finished. */
export function queueView(jobs: readonly Job[]): Job[] {
  return [...jobs.filter((j) => ACTIVE.has(j.state)), ...bySizeAscending(jobs.filter((j) => j.state === 'queued')), ...jobs.filter((j) => FINISHED.has(j.state))];
}

export function UploadPanel() {
  const { jobs, pause, pauseMessage, speed } = useStore(uploads);
  const [open, setOpen] = useState(true);
  const pending = jobs.filter((j) => !FINISHED.has(j.state));
  const hasProblems = jobs.some((j) => j.state === 'failed' || j.state === 'skipped');
  // Fold the list away once everything is through (unless something needs a look); open it again for new files.
  const busy = pending.length > 0;
  useEffect(() => setOpen(busy || hasProblems), [busy, hasProblems]);
  if (!jobs.length) return null;

  const counted = jobs.filter((j) => j.state !== 'failed' && j.state !== 'skipped');
  const total = counted.reduce((n, j) => n + j.size, 0);
  const sent = counted.reduce((n, j) => n + j.received, 0);
  const done = jobs.filter((j) => j.state === 'done').length;
  const left = total - sent;
  const eta = pending.length && speed > 0 && !pause && left / speed >= 1 ? formatDuration(left / speed) : '';
  const pct = total ? Math.min(100, (sent / total) * 100) : 100;

  const running = jobs.filter((j) => j.state === 'uploading').length;
  const title = pending.length
    ? pause
      ? `Uploads paused (${done} of ${done + pending.length} done)`
      : `Uploading${running > 1 ? ` ${running} at once` : ''} · ${done} of ${done + pending.length} done`
    : `Uploads finished (${done} of ${jobs.length})`;

  return (
    <section className="uploads" aria-label="Uploads">
      <header className="uploads-head">
        <button type="button" className="uploads-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="grow">
            <strong>{title}</strong>
            <span className="muted tiny">
              {' '}
              {formatBytes(sent)} of {formatBytes(total)}
              {eta && ` · ${formatBytes(speed)}/s · ~${eta} left`}
            </span>
          </span>
          <span aria-hidden="true">{open ? '▾' : '▴'}</span>
        </button>
        {!pending.length && (
          <button type="button" className="btn ghost small" onClick={clearFinished}>
            Clear
          </button>
        )}
      </header>
      <div className="bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      {pause && (
        <div className="pause-note small">
          <span className="grow">{pauseMessage}</span>
          {pause === 'login' ? (
            <button type="button" className="btn primary small" onClick={() => openLogin(pauseMessage)}>
              Enter password
            </button>
          ) : (
            <button type="button" className="btn primary small" onClick={resume}>
              Retry
            </button>
          )}
        </div>
      )}
      {open && (
        <ul className="uploads-list">
          {queueView(jobs).map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </ul>
      )}
      {open && pending.length > 1 && <p className="muted tiny uploads-note">Up to {MAX_PARALLEL} at once, smallest first. Keep this page open until it finishes.</p>}
    </section>
  );
}

const STATE_LABEL: Record<Job['state'], string> = { queued: 'Waiting', uploading: 'Uploading', paused: 'Paused', done: 'Uploaded', failed: 'Failed', skipped: 'Skipped' };

function JobRow({ job }: { job: Job }) {
  const pct = job.size ? (job.received / job.size) * 100 : job.state === 'done' ? 100 : 0;
  const finished = FINISHED.has(job.state);
  return (
    <li className={`job job-${job.state}`}>
      <div className="row">
        <span className="job-name grow" title={job.name}>
          {job.name}
        </span>
        <span className="muted tiny nowrap">
          {job.state === 'uploading' || job.state === 'paused' ? `${formatBytes(job.received)} / ` : ''}
          {formatBytes(job.size)}
        </span>
        <span className={`tiny nowrap state state-${job.state}`}>{job.state === 'done' ? '✓ ' : ''}{STATE_LABEL[job.state]}</span>
        {(job.state === 'failed' || job.state === 'skipped') && (
          <button type="button" className="icon-btn small" onClick={() => retryJob(job.id)} aria-label={`Retry ${job.name}`} title="Try again">
            ↻
          </button>
        )}
        {!finished && (
          <button type="button" className="icon-btn small" onClick={() => cancelJob(job.id)} aria-label={`Cancel ${job.name}`} title="Cancel">
            ✕
          </button>
        )}
      </div>
      {(job.state === 'uploading' || job.state === 'paused') && (
        <div className="bar thin">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {job.error && <p className={`tiny ${finished ? 'error' : 'muted'}`}>{job.error}</p>}
    </li>
  );
}
