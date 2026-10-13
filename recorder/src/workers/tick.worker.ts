/**
 * Timer worker. Main-thread timers are throttled in hidden tabs (≥1 s, or 1 min under
 * Chrome's intensive throttling) and requestAnimationFrame stops entirely. Dedicated worker
 * timers keep their rate, so this posts "tick" messages that drive the main-thread canvas
 * fallback compositor, fake sources, countdown and the REC title clock.
 */
type Msg = { type: 'start'; id: number; interval: number } | { type: 'stop'; id: number };

const scope = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<Msg>) => void) | null };
const timers = new Map<number, ReturnType<typeof setInterval>>();

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'start') {
    clearInterval(timers.get(m.id));
    timers.set(m.id, setInterval(() => scope.postMessage({ type: 'tick', id: m.id, t: performance.now() }), Math.max(4, m.interval)));
  } else if (m.type === 'stop') {
    clearInterval(timers.get(m.id));
    timers.delete(m.id);
  }
};
