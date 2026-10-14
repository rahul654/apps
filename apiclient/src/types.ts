import type { KV } from './lib/request/build';
import type { Timings } from './lib/request/send';
import type { PmCollection, PmEnvironmentFile } from './lib/postman/types';
import type { RunReport } from './lib/runner/runner';

export type { PmCollection, PmEnvironmentFile, RunReport };

/** One sent request, as kept in history. Bodies are text only and truncated for storage. */
export interface HistoryEntry {
  id: string;
  at: string;
  collectionId?: string;
  requestId?: string;
  requestName?: string;
  method: string;
  /** Resolved URL as sent. */
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  time: number;
  size: number;
  timings: Timings;
  via: 'direct' | 'proxy';
  request: { headers: KV[]; body: string | null };
  response: { headers: KV[]; bodyText: string; contentType: string; binary: boolean; truncated?: boolean; setCookie?: string[] };
  error?: { kind: string; message: string };
  runId?: string;
}

export interface CollectionRecord {
  id: string;
  data: PmCollection;
  updatedAt: string;
}

export interface Workspace {
  collections: PmCollection[];
  environments: PmEnvironmentFile[];
  globals: PmEnvironmentFile;
  activeEnvironmentId: string | null;
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
