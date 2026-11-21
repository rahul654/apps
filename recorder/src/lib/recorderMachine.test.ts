import { describe, expect, it } from 'vitest';
import { elapsedMs, initialRecState, phaseAnnouncement, recorderReducer as r, type RecAction, type RecState } from './recorderMachine';

const run = (actions: RecAction[], s: RecState = initialRecState) => actions.reduce(r, s);
const err = { title: 'x', message: 'y', canRetry: true };

describe('recorder state machine', () => {
  it('goes idle → preparing → countdown → recording → saving → done', () => {
    let s = run([{ type: 'PREPARE' }]);
    expect(s.phase).toBe('preparing');
    s = r(s, { type: 'COUNTDOWN', seconds: 3 });
    expect(s).toMatchObject({ phase: 'countdown', countdown: 3 });
    s = run([{ type: 'COUNTDOWN_TICK' }, { type: 'COUNTDOWN_TICK' }], s);
    expect(s.countdown).toBe(1);
    s = r(s, { type: 'START', now: 1000, recordingId: 'a' });
    expect(s).toMatchObject({ phase: 'recording', runningSince: 1000, recordingId: 'a', countdown: 0 });
    s = r(s, { type: 'STOP', now: 6000, reason: 'user' });
    expect(s).toMatchObject({ phase: 'saving', accumulatedMs: 5000, stopReason: 'user' });
    s = r(s, { type: 'SAVED', recordingId: 'a' });
    expect(s.phase).toBe('done');
    expect(r(s, { type: 'RESET' })).toEqual(initialRecState);
  });

  it('can start straight from preparing (countdown off or skipped)', () => {
    expect(run([{ type: 'PREPARE' }, { type: 'START', now: 0, recordingId: 'b' }]).phase).toBe('recording');
    expect(run([{ type: 'PREPARE' }, { type: 'COUNTDOWN', seconds: 0 }]).phase).toBe('preparing');
  });

  it('excludes paused time from the elapsed time', () => {
    const s = run([
      { type: 'PREPARE' },
      { type: 'START', now: 0, recordingId: 'a' },
      { type: 'PAUSE', now: 2000 },
    ]);
    expect(s.phase).toBe('paused');
    expect(elapsedMs(s, 10_000)).toBe(2000);
    const resumed = r(s, { type: 'RESUME', now: 10_000 });
    expect(elapsedMs(resumed, 11_500)).toBe(3500);
    const stopped = r(resumed, { type: 'STOP', now: 12_000, reason: 'max-duration' });
    expect(stopped.accumulatedMs).toBe(4000);
    expect(elapsedMs(stopped, 99_000)).toBe(4000);
  });

  it('stopping while paused works', () => {
    const s = run([{ type: 'PREPARE' }, { type: 'START', now: 0, recordingId: 'a' }, { type: 'PAUSE', now: 1000 }, { type: 'STOP', now: 5000, reason: 'share-ended' }]);
    expect(s).toMatchObject({ phase: 'saving', accumulatedMs: 1000 });
  });

  it('ignores invalid transitions', () => {
    expect(r(initialRecState, { type: 'PAUSE', now: 0 })).toBe(initialRecState);
    expect(r(initialRecState, { type: 'STOP', now: 0, reason: 'user' })).toBe(initialRecState);
    expect(r(initialRecState, { type: 'START', now: 0, recordingId: 'x' })).toBe(initialRecState);
    const rec = run([{ type: 'PREPARE' }, { type: 'START', now: 0, recordingId: 'a' }]);
    expect(r(rec, { type: 'PREPARE' })).toBe(rec);
    expect(r(rec, { type: 'RESUME', now: 5 })).toBe(rec);
    expect(r(rec, { type: 'CANCEL' })).toBe(rec);
    expect(r(rec, { type: 'SAVED', recordingId: 'a' })).toBe(rec);
  });

  it('cancel during preparing / countdown returns to idle', () => {
    expect(run([{ type: 'PREPARE' }, { type: 'CANCEL' }])).toEqual(initialRecState);
    expect(run([{ type: 'PREPARE' }, { type: 'COUNTDOWN', seconds: 3 }, { type: 'CANCEL' }])).toEqual(initialRecState);
  });

  it('discard from recording, paused or done', () => {
    expect(run([{ type: 'PREPARE' }, { type: 'START', now: 0, recordingId: 'a' }, { type: 'DISCARD' }])).toEqual(initialRecState);
    expect(run([{ type: 'PREPARE' }, { type: 'START', now: 0, recordingId: 'a' }, { type: 'PAUSE', now: 1 }, { type: 'DISCARD' }])).toEqual(initialRecState);
  });

  it('errors from any phase, retry via PREPARE or RESET', () => {
    const e1 = r(initialRecState, { type: 'FAIL', error: err });
    expect(e1).toMatchObject({ phase: 'error', error: err });
    expect(r(e1, { type: 'PREPARE' }).phase).toBe('preparing');
    const e2 = run([{ type: 'PREPARE' }, { type: 'START', now: 0, recordingId: 'a' }, { type: 'FAIL', error: err }]);
    expect(e2).toMatchObject({ phase: 'error', runningSince: null, recordingId: 'a' });
    expect(r(e2, { type: 'RESET' })).toEqual(initialRecState);
  });

  it('announces phases for screen readers', () => {
    expect(phaseAnnouncement(run([{ type: 'PREPARE' }, { type: 'COUNTDOWN', seconds: 3 }]))).toBe('Recording starts in 3');
    expect(phaseAnnouncement(run([{ type: 'PREPARE' }, { type: 'START', now: 0, recordingId: 'a' }, { type: 'STOP', now: 1, reason: 'share-ended' }]))).toMatch(/Screen sharing ended/);
    expect(phaseAnnouncement(initialRecState)).toBe('');
  });
});
