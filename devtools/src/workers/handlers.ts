// Op implementations run inside the worker (pure; unit-testable in Node).
import { utf8Encode } from '../lib/base64';
import { hashAll, hexToBytes } from '../lib/hash';
import { diffJson, formatJson, minifyJson, parseJson } from '../lib/json';
import { runRegex } from '../lib/regex';
import { diffLines } from '../lib/textdiff';
import type { OpName, Ops } from './protocol';

type Handlers = { [K in OpName]: (req: Ops[K]['req']) => Ops[K]['res'] | Promise<Ops[K]['res']> };

export const handlers: Handlers = {
  json(req) {
    const r = parseJson(req.text);
    if (!r.ok) return r;
    const output = req.minify ? minifyJson(r.value, req.sortKeys) : formatJson(r.value, req.indent, req.sortKeys);
    return { ok: true, output, value: req.wantValue ? r.value : undefined };
  },
  jsonDiff(req) {
    const a = parseJson(req.left);
    const b = parseJson(req.right);
    if (!a.ok || !b.ok) return { leftError: a.ok ? undefined : a.error, rightError: b.ok ? undefined : b.error, entries: [], truncated: false };
    return { ...diffJson(a.value, b.value) };
  },
  regex(req) {
    return runRegex(req);
  },
  async hash(req) {
    const data = req.file ? new Uint8Array(await req.file.arrayBuffer()) : utf8Encode(req.text ?? '');
    const key = req.hmacKey ? (req.hmacKey.encoding === 'hex' ? hexToBytes(req.hmacKey.value) : utf8Encode(req.hmacKey.value)) : undefined;
    return hashAll(data, key);
  },
  textDiff(req) {
    return diffLines(req.left, req.right, req);
  },
};
