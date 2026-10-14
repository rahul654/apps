/**
 * Collection runner: depth-first request order, N iterations (or one per data row), delay,
 * `setNextRequest` chaining (by name or id; null ends the iteration), stop on failure.
 * The executor is injected so the runner is pure and testable.
 */
import { listRequests } from '../postman/items';
import type { PmCollection, PmItem, PmItemGroup } from '../postman/types';
import type { TestResult } from '../scripts/types';
import type { DataRow } from './data';

export interface RunPlan {
  collection: PmCollection;
  folderId?: string;
  iterations: number;
  delayMs: number;
  data?: DataRow[];
  stopOnFailure: boolean;
}

export interface StepContext {
  iteration: number;
  iterationCount: number;
  data: DataRow;
}

export interface StepOutcome {
  status: number;
  statusText?: string;
  time: number;
  size?: number;
  url?: string;
  method?: string;
  tests: TestResult[];
  /** Transport or script error. */
  error?: string;
  nextRequest?: string | null;
  responseId?: string;
}

export interface RunStep extends StepOutcome {
  requestId: string;
  requestName: string;
  path: string;
  iteration: number;
  index: number;
  at: string;
  passed: number;
  failed: number;
}

export interface RunReport {
  id: string;
  collectionId: string;
  collectionName: string;
  folderId?: string;
  folderName?: string;
  startedAt: string;
  finishedAt: string;
  iterations: number;
  delayMs: number;
  steps: RunStep[];
  totals: { requests: number; passed: number; failed: number; errors: number };
  stopped: 'completed' | 'failure' | 'cancelled';
  schemaVersion: 1;
}

export type Executor = (item: PmItem, parents: PmItemGroup[], ctx: StepContext) => Promise<StepOutcome>;

export interface RunHooks {
  onStep?: (step: RunStep, report: RunReport) => void;
  onStart?: (report: RunReport) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  id?: () => string;
  now?: () => Date;
}

/** Index of the request a `setNextRequest` value refers to. */
export function findNextIndex(list: { item: PmItem }[], target: string): number {
  const byId = list.findIndex((r) => r.item.id === target);
  if (byId >= 0) return byId;
  return list.findIndex((r) => (r.item.name ?? '') === target);
}

const MAX_STEPS_PER_ITERATION = 1000;

export async function runCollection(plan: RunPlan, exec: Executor, hooks: RunHooks = {}): Promise<RunReport> {
  const list = listRequests(plan.collection, plan.folderId);
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = hooks.now ?? (() => new Date());
  const iterations = plan.data?.length ? plan.data.length : Math.max(1, Math.floor(plan.iterations) || 1);
  const folder = plan.folderId ? findFolderName(plan.collection, plan.folderId) : undefined;
  const report: RunReport = {
    id: hooks.id?.() ?? `run-${Date.now()}`,
    collectionId: plan.collection.info._postman_id ?? '',
    collectionName: plan.collection.info.name,
    ...(plan.folderId ? { folderId: plan.folderId, folderName: folder } : {}),
    startedAt: now().toISOString(),
    finishedAt: '',
    iterations,
    delayMs: plan.delayMs,
    steps: [],
    totals: { requests: 0, passed: 0, failed: 0, errors: 0 },
    stopped: 'completed',
  schemaVersion: 1,
  };
  hooks.onStart?.(report);
  outer: for (let iteration = 0; iteration < iterations; iteration++) {
    const data = plan.data?.[iteration] ?? {};
    let i = 0;
    let steps = 0;
    while (i < list.length) {
      if (hooks.signal?.aborted) {
        report.stopped = 'cancelled';
        break outer;
      }
      if (steps++ >= MAX_STEPS_PER_ITERATION) {
        report.steps.push(makeStep(list[i], iteration, report.steps.length, now(), { status: 0, time: 0, tests: [], error: `Stopped: more than ${MAX_STEPS_PER_ITERATION} requests in one iteration (setNextRequest loop?)` }));
        report.totals.errors++;
        report.stopped = 'failure';
        break outer;
      }
      const entry = list[i];
      if (report.steps.length && plan.delayMs > 0) await sleep(plan.delayMs);
      let outcome: StepOutcome;
      try {
        outcome = await exec(entry.item, entry.parents, { iteration, iterationCount: iterations, data });
      } catch (e) {
        outcome = { status: 0, time: 0, tests: [], error: e instanceof Error ? e.message : String(e) };
      }
      const step = makeStep(entry, iteration, report.steps.length, now(), outcome);
      report.steps.push(step);
      report.totals.requests++;
      report.totals.passed += step.passed;
      report.totals.failed += step.failed;
      if (step.error) report.totals.errors++;
      hooks.onStep?.(step, report);
      if (plan.stopOnFailure && (step.failed > 0 || step.error)) {
        report.stopped = 'failure';
        break outer;
      }
      if (outcome.nextRequest === null) break; // ends this iteration
      if (typeof outcome.nextRequest === 'string') {
        const next = findNextIndex(list, outcome.nextRequest);
        if (next >= 0) {
          i = next;
          continue;
        }
      }
      i++;
    }
  }
  report.finishedAt = now().toISOString();
  return report;
}

function makeStep(entry: { item: PmItem; parents: PmItemGroup[] }, iteration: number, index: number, at: Date, o: StepOutcome): RunStep {
  const passed = o.tests.filter((t) => t.passed).length;
  return {
    ...o,
    requestId: entry.item.id ?? '',
    requestName: entry.item.name ?? '',
    path: entry.parents.map((p) => p.name ?? '').join(' / '),
    iteration,
    index,
    at: at.toISOString(),
    passed,
    failed: o.tests.length - passed,
  };
}

function findFolderName(c: PmCollection, id: string): string | undefined {
  let name: string | undefined;
  const walk = (items: PmCollection['item']) => {
    for (const it of items) {
      if (it.id === id) name = it.name;
      if ('item' in it && Array.isArray(it.item)) walk(it.item);
    }
  };
  walk(c.item);
  return name;
}
