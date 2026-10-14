import { describe, expect, it } from 'vitest';
import type { PmCollection } from '../postman/types';
import { parseCsv, parseDataFile } from './data';
import { findNextIndex, runCollection, type Executor, type StepOutcome } from './runner';

const col: PmCollection = {
  info: { name: 'C', _postman_id: 'c1', schema: '' },
  item: [
    { id: 'a', name: 'A', request: 'https://x/a' },
    { id: 'f', name: 'F', item: [{ id: 'b', name: 'B', request: 'https://x/b' }, { id: 'c', name: 'C', request: 'https://x/c' }] },
    { id: 'd', name: 'D', request: 'https://x/d' },
  ],
};
const ok = (over: Partial<StepOutcome> = {}): StepOutcome => ({ status: 200, time: 1, tests: [{ name: 't', passed: true }], ...over });

describe('runner', () => {
  it('runs depth-first for N iterations with iteration data', async () => {
    const seen: string[] = [];
    const exec: Executor = async (item, _p, ctx) => {
      seen.push(`${ctx.iteration}:${item.name}:${ctx.data.row ?? '-'}`);
      return ok();
    };
    const report = await runCollection({ collection: col, iterations: 3, delayMs: 0, stopOnFailure: false }, exec, { sleep: async () => {} });
    expect(seen).toEqual(['0:A:-', '0:B:-', '0:C:-', '0:D:-', '1:A:-', '1:B:-', '1:C:-', '1:D:-', '2:A:-', '2:B:-', '2:C:-', '2:D:-']);
    expect(report.totals).toEqual({ requests: 12, passed: 12, failed: 0, errors: 0 });
    expect(report.stopped).toBe('completed');
    expect(report.steps[5]).toMatchObject({ requestName: 'B', path: 'F', iteration: 1, index: 5, passed: 1, failed: 0 });
    const withData = await runCollection({ collection: col, iterations: 5, delayMs: 0, stopOnFailure: false, data: [{ row: '1' }, { row: '2' }] }, exec, { sleep: async () => {} });
    expect(withData.iterations).toBe(2);
    expect(seen.slice(12)).toEqual(['0:A:1', '0:B:1', '0:C:1', '0:D:1', '1:A:2', '1:B:2', '1:C:2', '1:D:2']);
  });
  it('restricts to a folder and applies delays between requests', async () => {
    const delays: number[] = [];
    const seen: string[] = [];
    const exec: Executor = async (item) => {
      seen.push(item.name!);
      return ok();
    };
    await runCollection({ collection: col, folderId: 'f', iterations: 1, delayMs: 50, stopOnFailure: false }, exec, { sleep: async (ms) => void delays.push(ms) });
    expect(seen).toEqual(['B', 'C']);
    expect(delays).toEqual([50]);
  });
  it('follows setNextRequest by name/id, null ends the iteration, unknown names continue in order', async () => {
    const seen: string[] = [];
    const exec: Executor = async (item, _p, ctx) => {
      seen.push(`${ctx.iteration}${item.name}`);
      if (item.name === 'A' && ctx.iteration === 0) return ok({ nextRequest: 'D' });
      if (item.name === 'D' && ctx.iteration === 0) return ok({ nextRequest: 'b' });
      if (item.name === 'B' && ctx.iteration === 0) return ok({ nextRequest: null });
      if (item.name === 'A' && ctx.iteration === 1) return ok({ nextRequest: 'Nope' });
      return ok();
    };
    await runCollection({ collection: col, iterations: 2, delayMs: 0, stopOnFailure: false }, exec);
    expect(seen).toEqual(['0A', '0D', '0B', '1A', '1B', '1C', '1D']);
    expect(findNextIndex([{ item: { id: 'x', name: 'X', request: '' } }], 'X')).toBe(0);
    expect(findNextIndex([{ item: { id: 'x', name: 'X', request: '' } }], 'nope')).toBe(-1);
  });
  it('stops on failure and on thrown errors, and caps setNextRequest loops', async () => {
    const exec: Executor = async (item) => (item.name === 'B' ? ok({ tests: [{ name: 'x', passed: false, error: 'e' }] }) : ok());
    const r = await runCollection({ collection: col, iterations: 2, delayMs: 0, stopOnFailure: true }, exec);
    expect(r.steps.map((s) => s.requestName)).toEqual(['A', 'B']);
    expect(r.stopped).toBe('failure');
    expect(r.totals.failed).toBe(1);
    const throwing: Executor = async () => {
      throw new Error('boom');
    };
    const r2 = await runCollection({ collection: col, iterations: 1, delayMs: 0, stopOnFailure: false }, throwing);
    expect(r2.steps.every((s) => s.error === 'boom')).toBe(true);
    expect(r2.totals.errors).toBe(4);
    const loop: Executor = async () => ok({ nextRequest: 'A' });
    const r3 = await runCollection({ collection: col, iterations: 1, delayMs: 0, stopOnFailure: false }, loop);
    expect(r3.stopped).toBe('failure');
    expect(r3.steps[r3.steps.length - 1].error).toMatch(/loop/);
  });
  it('can be cancelled', async () => {
    const ac = new AbortController();
    const exec: Executor = async (item) => {
      if (item.name === 'B') ac.abort();
      return ok();
    };
    const r = await runCollection({ collection: col, iterations: 2, delayMs: 0, stopOnFailure: false }, exec, { signal: ac.signal });
    expect(r.steps.map((s) => s.requestName)).toEqual(['A', 'B']);
    expect(r.stopped).toBe('cancelled');
  });
});

describe('data files', () => {
  it('parses CSV with quotes, CRLF and BOM', () => {
    expect(parseCsv('﻿name,msg\r\nalice,"hi, ""there"""\r\nbob,x\n')).toEqual([{ name: 'alice', msg: 'hi, "there"' }, { name: 'bob', msg: 'x' }]);
    expect(parseCsv('only header')).toEqual([]);
  });
  it('parses JSON arrays with stringified values', () => {
    expect(parseDataFile('[{"a":1,"b":{"c":2},"d":null}]', 'x.json')).toEqual([{ a: '1', b: '{"c":2}', d: '' }]);
    expect(parseDataFile('a,b\n1,2')).toEqual([{ a: '1', b: '2' }]);
    expect(() => parseDataFile('[1]')).toThrow();
  });
});
