/**
 * Runs scripts in a sandboxed iframe (sandbox="allow-scripts": opaque origin, no access to this
 * app's storage or DOM). The runtime and chai are inlined into the frame's srcdoc. Messages are
 * accepted only from that frame's window. A hung script gets its frame destroyed.
 */
import { sandboxMain } from './runtime';
import type { FromSandbox, SandboxFetchRequest, SandboxFetchResponse, ScriptPayload, ScriptResult, ToSandbox } from './types';

export type FetchHandler = (req: SandboxFetchRequest) => Promise<SandboxFetchResponse>;

/** chai (~350 KB of source text) is loaded on first use, not with the app. */
async function buildSrcdoc(): Promise<string> {
  const { default: chaiSource } = await import('chai/chai.js?raw');
  const safe = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  const boot = `(${sandboxMain.toString()})({ chai: window.chai, post: function (m) { parent.postMessage(m, '*'); }, onMessage: function (h) { addEventListener('message', function (e) { if (e.source === parent) h(e.data); }); } });`;
  return `<!doctype html><meta charset="utf-8"><script>${safe(chaiSource)}</script><script>${safe(boot)}</script>`;
}

interface Pending {
  resolve: (r: ScriptResult) => void;
  reject: (e: Error) => void;
  onFetch: FetchHandler;
  timer: number;
}

export class ScriptHost {
  private frame: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private listener = (e: MessageEvent) => this.onMessage(e);

  private ensureFrame(): Promise<void> {
    if (this.frame && this.ready) return this.ready;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none';
    this.frame = frame;
    this.ready = new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('Script sandbox did not start')), 15000);
      const onReady = (e: MessageEvent) => {
        if (e.source !== frame.contentWindow || (e.data as FromSandbox)?.type !== 'ready') return;
        window.clearTimeout(t);
        window.removeEventListener('message', onReady);
        resolve();
      };
      window.addEventListener('message', onReady);
      buildSrcdoc()
        .then((doc) => {
          frame.srcdoc = doc;
          window.addEventListener('message', this.listener);
          document.body.appendChild(frame);
        })
        .catch(reject);
    });
    return this.ready;
  }

  private onMessage(e: MessageEvent) {
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    const msg = e.data as FromSandbox;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'done') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      window.clearTimeout(p.timer);
      p.resolve(msg.result);
    } else if (msg.type === 'fetch') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      p.onFetch(msg.request)
        .catch((err: unknown): SandboxFetchResponse => ({ code: 0, status: '', headers: [], body: '', responseTime: 0, error: err instanceof Error ? err.message : String(err) }))
        .then((response) => this.send({ type: 'fetchResult', reqId: msg.reqId, response }));
    }
  }

  private send(msg: ToSandbox) {
    this.frame?.contentWindow?.postMessage(msg, '*');
  }

  /** Destroys the frame; the next run starts a fresh one. Rejects anything still pending. */
  terminate(reason = 'Script sandbox was reset'): void {
    window.removeEventListener('message', this.listener);
    this.frame?.remove();
    this.frame = null;
    this.ready = null;
    for (const [, p] of this.pending) {
      window.clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  async run(payload: ScriptPayload, onFetch: FetchHandler): Promise<ScriptResult> {
    await this.ensureFrame();
    const timeout = (payload.timeout ?? 10000) + 1000;
    return new Promise<ScriptResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(payload.id);
        this.terminate(`Script "${payload.info.eventName}" for ${payload.info.requestName} did not finish within ${timeout} ms`);
        reject(new Error(`Script did not finish within ${timeout} ms and was stopped`));
      }, timeout);
      this.pending.set(payload.id, { resolve, reject, onFetch, timer });
      this.send({ type: 'run', payload });
    });
  }
}

let shared: ScriptHost | null = null;
export function scriptHost(): ScriptHost {
  if (!shared) shared = new ScriptHost();
  return shared;
}

/** Scripts stored in Postman's `event` array; exec may be a string or lines. */
export function eventScript(events: { listen: string; disabled?: boolean; script?: { exec?: string[] | string } }[] | undefined, listen: 'prerequest' | 'test'): string {
  const out: string[] = [];
  for (const e of events ?? []) {
    if (e.listen !== listen || e.disabled) continue;
    const exec = e.script?.exec;
    if (Array.isArray(exec)) out.push(exec.join('\n'));
    else if (typeof exec === 'string') out.push(exec);
  }
  return out.join('\n');
}
