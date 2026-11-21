import type { KV } from '../request/build';
import type { VarMap } from '../variables';

export interface ScriptRequestSnapshot {
  method: string;
  url: string;
  headers: KV[];
  body: string | null;
  name: string;
  id: string;
}

export interface ScriptResponseSnapshot {
  code: number;
  status: string;
  headers: KV[];
  body: string;
  responseTime: number;
  responseSize: number;
}

export interface ScriptPayload {
  id: string;
  kind: 'prerequest' | 'test';
  script: string;
  request: ScriptRequestSnapshot;
  response?: ScriptResponseSnapshot;
  variables: { globals: VarMap; environment: VarMap; collection: VarMap; local: VarMap; data: VarMap };
  info: { requestName: string; requestId: string; iteration: number; iterationCount: number; eventName: string };
  /** ms before the host gives up (sandbox also stops accepting callbacks). */
  timeout?: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ConsoleLine {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: string[];
}

export interface ScriptResult {
  tests: TestResult[];
  console: ConsoleLine[];
  variables: { globals: VarMap; environment: VarMap; collection: VarMap; local: VarMap };
  /** undefined = untouched; null = stop the run; string = next request name/id. */
  nextRequest?: string | null;
  /** Pre-request scripts may change the outgoing request. */
  request: ScriptRequestSnapshot;
  /** Uncaught error outside pm.test. */
  error?: string;
  skipped?: boolean;
}

/** A request the script asked the host to send (`pm.sendRequest`). */
export interface SandboxFetchRequest {
  method: string;
  url: string;
  headers: KV[];
  body: string | null;
}
export interface SandboxFetchResponse {
  code: number;
  status: string;
  headers: KV[];
  body: string;
  responseTime: number;
  error?: string;
}

export type ToSandbox = { type: 'run'; payload: ScriptPayload } | { type: 'fetchResult'; reqId: string; response: SandboxFetchResponse };
export type FromSandbox = { type: 'ready' } | { type: 'done'; id: string; result: ScriptResult } | { type: 'fetch'; id: string; reqId: string; request: SandboxFetchRequest };
