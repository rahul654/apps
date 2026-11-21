import { useEffect, useRef, useState } from 'react';
import { ComputeClient, TimeoutError } from '../workers/client';
import type { OpName, Ops } from '../workers/protocol';

export interface ComputeState<T> {
  result: T | undefined;
  error: string | undefined;
  timedOut: boolean;
  busy: boolean;
}

export interface ComputeOptions {
  delay?: number;
  timeout?: number;
  /**
   * When the payload changes while a job is still running, kill the busy worker at once
   * (instead of waiting for it to finish or time out). Use for jobs that can hang, e.g. regex.
   */
  cancelInFlight?: boolean;
}

/**
 * Run `op` in a worker whenever `payload` changes (debounced). Pass `null` to clear.
 * `payload` must be referentially stable (wrap it in useMemo). Stale responses are ignored.
 */
export function useCompute<K extends OpName>(op: K, payload: Ops[K]['req'] | null, opts: ComputeOptions = {}): ComputeState<Ops[K]['res']> {
  const clientRef = useRef<ComputeClient | null>(null);
  const seq = useRef(0);
  const [state, setState] = useState<ComputeState<Ops[K]['res']>>({ result: undefined, error: undefined, timedOut: false, busy: false });
  const { delay = 150, timeout, cancelInFlight = false } = opts;

  useEffect(() => () => clientRef.current?.terminate(), []);

  useEffect(() => {
    const id = ++seq.current;
    // The previous job is now stale: stop it immediately if it may be stuck.
    if (cancelInFlight) clientRef.current?.cancel();
    if (payload === null) {
      setState({ result: undefined, error: undefined, timedOut: false, busy: false });
      return;
    }
    // A new job supersedes old errors/timeouts; keep the last result visible until it finishes.
    setState((s) => (s.busy && !s.error && !s.timedOut ? s : { ...s, error: undefined, timedOut: false, busy: true }));
    const timer = setTimeout(() => {
      clientRef.current ??= new ComputeClient();
      clientRef.current.run(op, payload, { timeoutMs: timeout, latestWins: cancelInFlight }).then(
        (result) => {
          if (id === seq.current) setState({ result, error: undefined, timedOut: false, busy: false });
        },
        (err: Error) => {
          if (id !== seq.current) return;
          setState({ result: undefined, error: err.message, timedOut: err instanceof TimeoutError, busy: false });
        },
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [op, payload, delay, timeout, cancelInFlight]);

  return state;
}
