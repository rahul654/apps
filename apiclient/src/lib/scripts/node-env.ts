/** Test helper: runs the sandbox runtime in-process with a fake message channel. */
import * as chai from 'chai';
import { sandboxMain } from './runtime';
import type { FromSandbox, SandboxFetchRequest, SandboxFetchResponse, ScriptPayload, ScriptResult, ToSandbox } from './types';

export function createInProcessRunner(onFetch?: (req: SandboxFetchRequest) => Promise<SandboxFetchResponse>) {
  let handler: ((m: ToSandbox) => void) | null = null;
  const waiting = new Map<string, (r: ScriptResult) => void>();
  sandboxMain({
    chai,
    onMessage: (h) => {
      handler = h;
    },
    post: (m: FromSandbox) => {
      if (m.type === 'done') waiting.get(m.id)?.(m.result);
      else if (m.type === 'fetch') {
        const fx = onFetch ?? (async () => ({ code: 0, status: '', headers: [], body: '', responseTime: 0, error: 'no fetch handler' }));
        fx(m.request).then((response) => handler?.({ type: 'fetchResult', reqId: m.reqId, response }));
      }
    },
  });
  return (payload: ScriptPayload) =>
    new Promise<ScriptResult>((resolve) => {
      waiting.set(payload.id, resolve);
      handler?.({ type: 'run', payload });
    });
}

let n = 0;
export function payload(script: string, over: Partial<ScriptPayload> = {}): ScriptPayload {
  return {
    id: `p${++n}`,
    kind: 'test',
    script,
    request: { method: 'GET', url: 'https://example.com/x', headers: [], body: null, name: 'Req', id: 'r1' },
    response: { code: 200, status: 'OK', headers: [{ key: 'content-type', value: 'application/json' }], body: '{"a":1,"list":[1,2]}', responseTime: 12, responseSize: 20 },
    variables: { globals: {}, environment: {}, collection: {}, local: {}, data: {} },
    info: { requestName: 'Req', requestId: 'r1', iteration: 0, iterationCount: 1, eventName: 'test' },
    ...over,
  };
}
