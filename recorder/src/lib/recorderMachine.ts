/**
 * Recorder state machine (pure reducer).
 *
 *   idle → preparing → countdown → recording ⇄ paused → saving → done
 *            │             │           │          │        └──→ error
 *            └─────────────┴── cancel ─┴─ discard ┘
 *
 * `preparing` covers the permission / screen-picker prompt. Times are passed in by the
 * caller (ms, monotonic clock), so the reducer stays deterministic.
 */

export type Phase = 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'saving' | 'done' | 'error';
export type StopReason = 'user' | 'max-duration' | 'share-ended' | 'device-lost';

export interface RecError {
  title: string;
  message: string;
  canRetry: boolean;
}

export interface RecState {
  phase: Phase;
  /** Seconds left in the countdown. */
  countdown: number;
  /** Clock time of the last start / resume while recording, else null. */
  runningSince: number | null;
  /** Recorded time before `runningSince`. */
  accumulatedMs: number;
  recordingId: string | null;
  stopReason: StopReason | null;
  error: RecError | null;
}

export type RecAction =
  | { type: 'PREPARE' }
  | { type: 'COUNTDOWN'; seconds: number }
  | { type: 'COUNTDOWN_TICK' }
  | { type: 'START'; now: number; recordingId: string }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'STOP'; now: number; reason: StopReason }
  | { type: 'SAVED'; recordingId: string }
  | { type: 'FAIL'; error: RecError }
  | { type: 'CANCEL' }
  | { type: 'DISCARD' }
  | { type: 'RESET' };

export const initialRecState: RecState = {
  phase: 'idle',
  countdown: 0,
  runningSince: null,
  accumulatedMs: 0,
  recordingId: null,
  stopReason: null,
  error: null,
};

export function recorderReducer(state: RecState, action: RecAction): RecState {
  switch (action.type) {
    case 'PREPARE':
      return state.phase === 'idle' || state.phase === 'done' || state.phase === 'error' ? { ...initialRecState, phase: 'preparing' } : state;
    case 'COUNTDOWN':
      if (state.phase !== 'preparing') return state;
      return action.seconds > 0 ? { ...state, phase: 'countdown', countdown: Math.floor(action.seconds) } : state;
    case 'COUNTDOWN_TICK':
      if (state.phase !== 'countdown') return state;
      return { ...state, countdown: Math.max(0, state.countdown - 1) };
    case 'START':
      if (state.phase !== 'preparing' && state.phase !== 'countdown') return state;
      return { ...state, phase: 'recording', countdown: 0, runningSince: action.now, accumulatedMs: 0, recordingId: action.recordingId };
    case 'PAUSE':
      if (state.phase !== 'recording' || state.runningSince === null) return state;
      return { ...state, phase: 'paused', accumulatedMs: state.accumulatedMs + Math.max(0, action.now - state.runningSince), runningSince: null };
    case 'RESUME':
      if (state.phase !== 'paused') return state;
      return { ...state, phase: 'recording', runningSince: action.now };
    case 'STOP':
      if (state.phase !== 'recording' && state.phase !== 'paused') return state;
      return { ...state, phase: 'saving', accumulatedMs: elapsedMs(state, action.now), runningSince: null, stopReason: action.reason };
    case 'SAVED':
      if (state.phase !== 'saving') return state;
      return { ...state, phase: 'done', recordingId: action.recordingId };
    case 'FAIL':
      if (state.phase === 'idle') return { ...initialRecState, phase: 'error', error: action.error };
      return { ...state, phase: 'error', runningSince: null, error: action.error };
    case 'CANCEL':
      return state.phase === 'preparing' || state.phase === 'countdown' ? initialRecState : state;
    case 'DISCARD':
      return state.phase === 'recording' || state.phase === 'paused' || state.phase === 'saving' || state.phase === 'done' ? initialRecState : state;
    case 'RESET':
      return state.phase === 'done' || state.phase === 'error' ? initialRecState : state;
    default:
      return state;
  }
}

/** Recorded time (excluding pauses) at clock time `now`. */
export function elapsedMs(state: RecState, now: number): number {
  return state.accumulatedMs + (state.runningSince !== null ? Math.max(0, now - state.runningSince) : 0);
}

export const isActive = (p: Phase) => p === 'recording' || p === 'paused';
export const isBusy = (p: Phase) => p === 'preparing' || p === 'countdown' || p === 'recording' || p === 'paused' || p === 'saving';

/** Announcement for the live region when the phase changes. */
export function phaseAnnouncement(state: RecState): string {
  switch (state.phase) {
    case 'preparing':
      return 'Waiting for permission';
    case 'countdown':
      return `Recording starts in ${state.countdown}`;
    case 'recording':
      return 'Recording';
    case 'paused':
      return 'Recording paused';
    case 'saving':
      return state.stopReason === 'share-ended'
        ? 'Screen sharing ended. Saving recording'
        : state.stopReason === 'max-duration'
          ? 'Maximum length reached. Saving recording'
          : 'Saving recording';
    case 'done':
      return 'Recording saved';
    case 'error':
      return state.error ? `Error: ${state.error.title}` : 'Error';
    default:
      return '';
  }
}
