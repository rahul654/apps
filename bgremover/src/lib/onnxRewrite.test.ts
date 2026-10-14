import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { encodeNode, graphNodes, int64Tensor, intAttr, narrowWideNodes, ProtoWriter, readInt64Tensor, readIntAttr, tensorAttr, type OnnxNode } from './onnxRewrite';

const node = (opType: string, inputs: string[], outputs: string[], attrs: [string, Uint8Array][] = []): OnnxNode => ({ opType, inputs, outputs, name: `${opType}_${outputs[0]}`, domain: '', attrs: new Map(attrs) });

/** ValueInfoProto for a float tensor of the given shape. */
function valueInfo(name: string, dims: number[]) {
  const shape = new ProtoWriter();
  for (const d of dims) shape.bytes(1, new ProtoWriter().int(1, d).finish());
  const tensorType = new ProtoWriter().int(1, 1).bytes(2, shape.finish()).finish();
  return new ProtoWriter().string(1, name).bytes(2, new ProtoWriter().bytes(1, tensorType).finish()).finish();
}

/** X[1,n] → Split into n columns → Concat them in reverse → Y[1,n]. */
function buildModel(n: number): Uint8Array {
  const cols = Array.from({ length: n }, (_, i) => `c${i}`);
  const graph = new ProtoWriter();
  graph.bytes(1, encodeNode(node('Constant', [], ['sizes'], [['value', tensorAttr('value', int64Tensor(Array(n).fill(1)))]])));
  graph.bytes(1, encodeNode(node('Split', ['X', 'sizes'], cols, [['axis', intAttr('axis', -1)]])));
  graph.bytes(1, encodeNode(node('Concat', [...cols].reverse(), ['Y'], [['axis', intAttr('axis', 1)]])));
  graph.string(2, 'g');
  graph.bytes(11, valueInfo('X', [1, n]));
  graph.bytes(12, valueInfo('Y', [1, n]));
  const opset = new ProtoWriter().string(1, '').int(2, 17).finish();
  return new ProtoWriter().int(1, 8).bytes(8, opset).bytes(7, graph.finish()).finish();
}

async function run(model: Uint8Array, n: number) {
  ort.env.wasm.numThreads = 1;
  const s = await ort.InferenceSession.create(model);
  const x = Float32Array.from({ length: n }, (_, i) => i);
  const out = await s.run({ X: new ort.Tensor('float32', x, [1, n]) });
  return [...(out.Y.data as Float32Array)];
}

describe('onnxRewrite', () => {
  it('round-trips attributes and int64 tensors', () => {
    expect(readIntAttr(intAttr('axis', -2))).toBe(-2);
    expect(readInt64Tensor(int64Tensor([1, 32, -5]))).toEqual([1, 32, -5]);
  });

  it('leaves narrow models byte-for-byte unchanged', () => {
    const m = buildModel(5);
    expect(narrowWideNodes(m).model).toBe(m);
  });

  it('splits wide Concat/Split into trees with at most maxFan inputs or outputs', () => {
    const { model, stats } = narrowWideNodes(buildModel(40), 6);
    expect(stats).toEqual({ concats: 1, splits: 1 });
    const nodes = graphNodes(model);
    for (const n of nodes) {
      if (n.opType === 'Concat') expect(n.inputs.length).toBeLessThanOrEqual(6);
      if (n.opType === 'Split') expect(n.outputs.length).toBeLessThanOrEqual(6);
    }
    // Every original output name still exists, and nodes are in topological order.
    const produced = new Set(['X']);
    for (const n of nodes) {
      for (const i of n.inputs) expect(produced.has(i), `${n.name} uses ${i} before it exists`).toBe(true);
      for (const o of n.outputs) produced.add(o);
    }
    for (let i = 0; i < 40; i++) expect(produced.has(`c${i}`)).toBe(true);
    expect(produced.has('Y')).toBe(true);
  });

  it('computes exactly the same result in ONNX Runtime', async () => {
    const n = 40;
    const orig = buildModel(n);
    const want = Array.from({ length: n }, (_, i) => n - 1 - i);
    expect(await run(orig, n)).toEqual(want);
    expect(await run(narrowWideNodes(orig, 6).model, n)).toEqual(want);
    expect(await run(narrowWideNodes(orig, 2).model, n)).toEqual(want);
  });
});
