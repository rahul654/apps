// Typed messages between the UI and compute.worker.ts.
import type { JsonDiffEntry, JsonError } from '../lib/json';
import type { HashResult } from '../lib/hash';
import type { RegexRequest, RegexResponse } from '../lib/regex';
import type { LineDiff, LineDiffOptions } from '../lib/textdiff';

export interface JsonFormatReq {
  text: string;
  indent: 2 | 4 | 'tab';
  sortKeys: boolean;
  minify: boolean;
  /** Also return the parsed value (for the tree view). */
  wantValue: boolean;
}
export type JsonFormatRes = { ok: true; output: string; value?: unknown } | { ok: false; error: JsonError };

export interface JsonDiffReq {
  left: string;
  right: string;
}
export interface JsonDiffRes {
  leftError?: JsonError;
  rightError?: JsonError;
  entries: JsonDiffEntry[];
  truncated: boolean;
}

export interface HashReq {
  /** Text (UTF-8 encoded in the worker) or a File/Blob read in the worker. */
  text?: string;
  file?: Blob;
  hmacKey?: { value: string; encoding: 'utf8' | 'hex' };
}
export type HashRes = HashResult[];

export interface TextDiffReq extends LineDiffOptions {
  left: string;
  right: string;
}

export interface Ops {
  json: { req: JsonFormatReq; res: JsonFormatRes };
  jsonDiff: { req: JsonDiffReq; res: JsonDiffRes };
  regex: { req: RegexRequest; res: RegexResponse };
  hash: { req: HashReq; res: HashRes };
  textDiff: { req: TextDiffReq; res: LineDiff };
}

export type OpName = keyof Ops;

export interface WorkerRequest<K extends OpName = OpName> {
  id: number;
  op: K;
  payload: Ops[K]['req'];
}

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
