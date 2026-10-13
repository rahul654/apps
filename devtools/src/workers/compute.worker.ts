// Runs heavy or potentially slow work (big JSON, regex, hashing, diff) off the main thread.
import { handlers } from './handlers';
import type { OpName, WorkerRequest, WorkerResponse } from './protocol';

const post = (msg: WorkerResponse) => (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(msg);

self.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const { id, op, payload } = e.data;
  try {
    const handler = handlers[op as OpName] as (p: unknown) => unknown;
    const result = await handler(payload);
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
