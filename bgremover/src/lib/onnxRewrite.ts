/**
 * Minimal ONNX (protobuf) graph rewrite so wide nodes fit WebGPU's limits.
 *
 * BiRefNet's decoder has a Concat with 1024 inputs and Splits with 32 outputs. ONNX Runtime's WebGPU
 * kernels bind every input/output as a storage buffer in one shader, and adapters allow ~8–10 per
 * stage ("Too many storage buffers in shader. Current: 11, Max is 10"); the older JSEP kernels
 * generate WGSL that is too deeply nested instead. Splitting those nodes into trees of narrow nodes
 * gives the same result with every shader under the limit.
 *
 * Only the graph's node list is decoded; everything else (including the weights) is copied as raw
 * bytes. Field numbers follow onnx.proto3.
 */

// ---------- protobuf primitives ----------

interface Field {
  no: number;
  wire: number;
  /** Start of the whole field (tag included) and end, in the source buffer. */
  start: number;
  end: number;
  /** For length-delimited fields: the payload range. For varints: the value. */
  valStart: number;
  valEnd: number;
  varint: bigint;
}

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error('Truncated protobuf');
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7n;
    if (shift > 70n) throw new Error('Bad varint');
  }
}

function* fields(buf: Uint8Array, start = 0, end = buf.length): Generator<Field> {
  let pos = start;
  while (pos < end) {
    const fStart = pos;
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const no = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    let valStart = pos;
    let valEnd = pos;
    let varint = 0n;
    if (wire === 0) {
      [varint, pos] = readVarint(buf, pos);
      valEnd = pos;
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      valStart = p2;
      valEnd = p2 + Number(len);
      pos = valEnd;
    } else if (wire === 1) {
      pos += 8;
      valEnd = pos;
    } else if (wire === 5) {
      pos += 4;
      valEnd = pos;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
    if (pos > end) throw new Error('Truncated protobuf');
    yield { no, wire, start: fStart, end: pos, valStart, valEnd, varint };
  }
}

const utf8 = new TextDecoder();
const enc = new TextEncoder();

export class ProtoWriter {
  private chunks: Uint8Array[] = [];
  length = 0;
  raw(b: Uint8Array) {
    this.chunks.push(b);
    this.length += b.length;
    return this;
  }
  varint(v: bigint | number) {
    let x = BigInt.asUintN(64, BigInt(v));
    const out: number[] = [];
    do {
      let b = Number(x & 0x7fn);
      x >>= 7n;
      if (x) b |= 0x80;
      out.push(b);
    } while (x);
    return this.raw(Uint8Array.from(out));
  }
  tag(no: number, wire: number) {
    return this.varint((no << 3) | wire);
  }
  bytes(no: number, b: Uint8Array) {
    return this.tag(no, 2).varint(b.length).raw(b);
  }
  string(no: number, s: string) {
    return this.bytes(no, enc.encode(s));
  }
  int(no: number, v: number) {
    return this.tag(no, 0).varint(v);
  }
  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

// ---------- ONNX structures (only what we need) ----------

// ModelProto.graph = 7; GraphProto.node = 1;
// NodeProto: input = 1, output = 2, name = 3, op_type = 4, attribute = 5, domain = 7
// AttributeProto: name = 1, i = 3, t = 5, type = 20 (INT = 2, TENSOR = 4)
// TensorProto: dims = 1, data_type = 2 (INT64 = 7), int64_data = 7, raw_data = 9

export interface OnnxNode {
  inputs: string[];
  outputs: string[];
  name: string;
  opType: string;
  domain: string;
  /** Attribute name → raw AttributeProto bytes (kept verbatim) */
  attrs: Map<string, Uint8Array>;
}

export function decodeNode(buf: Uint8Array): OnnxNode {
  const n: OnnxNode = { inputs: [], outputs: [], name: '', opType: '', domain: '', attrs: new Map() };
  for (const f of fields(buf)) {
    const s = () => utf8.decode(buf.subarray(f.valStart, f.valEnd));
    if (f.no === 1) n.inputs.push(s());
    else if (f.no === 2) n.outputs.push(s());
    else if (f.no === 3) n.name = s();
    else if (f.no === 4) n.opType = s();
    else if (f.no === 7) n.domain = s();
    else if (f.no === 5) {
      const a = buf.subarray(f.valStart, f.valEnd);
      let name = '';
      for (const af of fields(a)) if (af.no === 1) name = utf8.decode(a.subarray(af.valStart, af.valEnd));
      n.attrs.set(name, a);
    }
  }
  return n;
}

export function encodeNode(n: OnnxNode): Uint8Array {
  const w = new ProtoWriter();
  for (const i of n.inputs) w.string(1, i);
  for (const o of n.outputs) w.string(2, o);
  if (n.name) w.string(3, n.name);
  w.string(4, n.opType);
  for (const a of n.attrs.values()) w.bytes(5, a);
  if (n.domain) w.string(7, n.domain);
  return w.finish();
}

export const intAttr = (name: string, v: number) => new ProtoWriter().string(1, name).int(3, v).int(20, 2).finish();

export function int64Tensor(values: number[]): Uint8Array {
  const raw = new Uint8Array(values.length * 8);
  const dv = new DataView(raw.buffer);
  values.forEach((v, i) => dv.setBigInt64(i * 8, BigInt(v), true));
  return new ProtoWriter().int(1, values.length).int(2, 7).bytes(9, raw).finish();
}

export const tensorAttr = (name: string, tensor: Uint8Array) => new ProtoWriter().string(1, name).bytes(5, tensor).int(20, 4).finish();

/** Integer value of an INT attribute, or undefined. */
export function readIntAttr(attr: Uint8Array | undefined): number | undefined {
  if (!attr) return undefined;
  for (const f of fields(attr)) if (f.no === 3 && f.wire === 0) return Number(BigInt.asIntN(64, f.varint));
  return undefined;
}

/** Values of an INT64 tensor (raw_data or int64_data), or null for other types. */
export function readInt64Tensor(t: Uint8Array): number[] | null {
  let type = 0;
  const values: number[] = [];
  for (const f of fields(t)) {
    if (f.no === 2) type = Number(f.varint);
    else if (f.no === 9) {
      const dv = new DataView(t.buffer, t.byteOffset + f.valStart, f.valEnd - f.valStart);
      for (let o = 0; o + 8 <= dv.byteLength; o += 8) values.push(Number(dv.getBigInt64(o, true)));
    } else if (f.no === 7) {
      if (f.wire === 2) {
        let p = f.valStart;
        while (p < f.valEnd) {
          const [v, np] = readVarint(t, p);
          values.push(Number(BigInt.asIntN(64, v)));
          p = np;
        }
      } else values.push(Number(BigInt.asIntN(64, f.varint)));
    }
  }
  return type === 7 ? values : null;
}

/** The tensor of a Constant node's `value` attribute. */
function constantTensor(n: OnnxNode): Uint8Array | null {
  const a = n.attrs.get('value');
  if (!a) return null;
  for (const f of fields(a)) if (f.no === 5) return a.subarray(f.valStart, f.valEnd);
  return null;
}

// ---------- the rewrite ----------

export interface RewriteStats {
  concats: number;
  splits: number;
}

/**
 * Returns a model where no Concat has more than `maxFan` inputs and no Split more than `maxFan`
 * outputs (when its split sizes are constants). Returns the input unchanged if nothing needed it.
 */
export function narrowWideNodes(model: Uint8Array, maxFan = 6): { model: Uint8Array; stats: RewriteStats } {
  const stats: RewriteStats = { concats: 0, splits: 0 };
  let graph: Field | null = null;
  for (const f of fields(model)) if (f.no === 7 && f.wire === 2) graph = f;
  if (!graph) return { model, stats };

  // First pass: find wide nodes and the int64 constants they may need.
  const gFields = [...fields(model, graph.valStart, graph.valEnd)];
  const nodes = new Map<Field, OnnxNode>();
  const constants = new Map<string, number[]>();
  for (const f of gFields) {
    if (f.no !== 1) continue;
    const n = decodeNode(model.subarray(f.valStart, f.valEnd));
    if (n.opType === 'Constant' && !n.domain) {
      const t = constantTensor(n);
      const vals = t && readInt64Tensor(t);
      if (vals) constants.set(n.outputs[0], vals);
    }
    if (!n.domain && ((n.opType === 'Concat' && n.inputs.length > maxFan) || (n.opType === 'Split' && n.outputs.length > maxFan))) nodes.set(f, n);
  }
  if (!nodes.size) return { model, stats };

  let seq = 0;
  const uid = (base: string) => `${base}__narrow${++seq}`;
  const out = new ProtoWriter();
  const emit = (n: OnnxNode) => out.bytes(1, encodeNode(n));

  const concatTree = (n: OnnxNode) => {
    const axis = n.attrs.get('axis');
    let level = n.inputs;
    while (level.length > maxFan) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += maxFan) {
        const chunk = level.slice(i, i + maxFan);
        if (chunk.length === 1) {
          next.push(chunk[0]);
          continue;
        }
        const o = uid(n.outputs[0]);
        emit({ inputs: chunk, outputs: [o], name: uid(n.name), opType: 'Concat', domain: '', attrs: new Map(axis ? [['axis', axis]] : []) });
        next.push(o);
      }
      level = next;
    }
    emit({ ...n, inputs: level });
  };

  const splitTree = (n: OnnxNode, x: string, sizes: number[], outputs: string[]) => {
    const axis = n.attrs.get('axis');
    const sizesConst = (vals: number[]) => {
      const name = uid(`${n.name}_sizes`);
      emit({ inputs: [], outputs: [name], name, opType: 'Constant', domain: '', attrs: new Map([['value', tensorAttr('value', int64Tensor(vals))]]) });
      return name;
    };
    const attrs = new Map(axis ? [['axis', axis]] : []);
    if (outputs.length <= maxFan) {
      emit({ inputs: [x, sizesConst(sizes)], outputs, name: uid(n.name), opType: 'Split', domain: '', attrs });
      return;
    }
    const per = Math.ceil(outputs.length / maxFan);
    const groups: { sizes: number[]; outs: string[] }[] = [];
    for (let i = 0; i < outputs.length; i += per) groups.push({ sizes: sizes.slice(i, i + per), outs: outputs.slice(i, i + per) });
    const mids = groups.map((g) => (g.outs.length === 1 ? g.outs[0] : uid(n.name)));
    emit({ inputs: [x, sizesConst(groups.map((g) => g.sizes.reduce((a, b) => a + b, 0)))], outputs: mids, name: uid(n.name), opType: 'Split', domain: '', attrs });
    groups.forEach((g, i) => {
      if (g.outs.length > 1) splitTree(n, mids[i], g.sizes, g.outs);
    });
  };

  for (const f of gFields) {
    const n = nodes.get(f);
    if (!n) {
      out.raw(model.subarray(f.start, f.end));
      continue;
    }
    if (n.opType === 'Concat') {
      concatTree(n);
      stats.concats++;
      continue;
    }
    const sizes = n.inputs[1] ? constants.get(n.inputs[1]) : undefined;
    if (!sizes || sizes.length !== n.outputs.length) {
      out.raw(model.subarray(f.start, f.end)); // sizes not known statically: leave it
      continue;
    }
    splitTree(n, n.inputs[0], sizes, n.outputs);
    stats.splits++;
  }

  const newGraph = out.finish();
  const result = new ProtoWriter();
  for (const f of fields(model)) {
    if (f.no === 7 && f.start === graph.start) result.bytes(7, newGraph);
    else result.raw(model.subarray(f.start, f.end));
  }
  return { model: result.finish(), stats };
}

/** All nodes of a model's main graph, decoded (for tests and diagnostics). */
export function graphNodes(model: Uint8Array): OnnxNode[] {
  const out: OnnxNode[] = [];
  for (const f of fields(model)) {
    if (f.no !== 7 || f.wire !== 2) continue;
    for (const g of fields(model, f.valStart, f.valEnd)) if (g.no === 1) out.push(decodeNode(model.subarray(g.valStart, g.valEnd)));
  }
  return out;
}
