import { describe, expect, it } from 'vitest';
import { edgePoint, fractionalIndex, seededRandom } from './elements';
import { TEMPLATES } from './templates';
import { validateElements } from './schema';
import type { SceneElement } from './types';

type Bound = { id: string; type: string };
type Binding = { elementId: string; focus: number; gap: number };
/** < 1 inside the shape grown by `grow` on every side, 1 on its outline, > 1 outside. */
function outline(el: SceneElement, x: number, y: number, grow: number): number {
  const hw = (el.width as number) / 2 + grow;
  const hh = (el.height as number) / 2 + grow;
  const dx = Math.abs(x - ((el.x as number) + (el.width as number) / 2));
  const dy = Math.abs(y - ((el.y as number) + (el.height as number) / 2));
  if (el.type === 'ellipse') return Math.hypot(dx / hw, dy / hh);
  if (el.type === 'diamond') return dx / hw + dy / hh;
  return Math.max(dx / hw, dy / hh);
}

const BINDABLE = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'image', 'frame']);

describe('fractionalIndex', () => {
  it('produces strictly increasing valid keys across length boundaries', () => {
    const keys = Array.from({ length: 4000 }, (_, i) => fractionalIndex(i));
    expect(keys.slice(0, 3)).toEqual(['a0', 'a1', 'a2']);
    expect(keys[61]).toBe('az');
    expect(keys[62]).toBe('b00');
    expect(keys[62 + 62 * 62]).toBe('c000');
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true);
    expect(() => fractionalIndex(-1)).toThrow();
  });
});

describe('edgePoint', () => {
  const el = (type: string): SceneElement => ({ id: 'x', type, x: 0, y: 0, width: 200, height: 100 });
  it('lands on the outline of each shape type', () => {
    expect(edgePoint(el('rectangle'), [500, 50], 0)).toEqual([200, 50]);
    expect(edgePoint(el('ellipse'), [100, 500], 0)).toEqual([100, 100]);
    const [x, y] = edgePoint(el('diamond'), [300, 150], 0);
    expect(Math.abs(x - 100) / 100 + Math.abs(y - 50) / 50).toBeCloseTo(1, 6);
  });
});

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  const { elements, appState } = template.build({ random: seededRandom(42), now: 1_700_000_000_000 });
  const byId = new Map(elements.map((e) => [e.id, e]));

  it('has elements with unique ids that survive validation', () => {
    expect(elements.length).toBeGreaterThan(5);
    expect(byId.size).toBe(elements.length);
    expect(validateElements(elements).elements).toHaveLength(elements.length);
    expect(appState.viewBackgroundColor).toBe('#ffffff');
  });

  it('has the fields Excalidraw needs and ascending indices', () => {
    for (const [i, el] of elements.entries()) {
      for (const k of ['x', 'y', 'width', 'height', 'angle', 'seed', 'version', 'versionNonce'] as const) expect(Number.isFinite(el[k]), `${el.type}.${k}`).toBe(true);
      expect(el.index).toBe(fractionalIndex(i));
      expect(Array.isArray(el.groupIds) && Array.isArray(el.boundElements)).toBe(true);
      expect(el.isDeleted).toBe(false);
      if (el.type === 'text') {
        expect(typeof el.text === 'string' && el.text === el.originalText).toBe(true);
        expect(el.fontSize).toBeGreaterThan(0);
      }
      if (el.type === 'arrow' || el.type === 'line') {
        const pts = el.points as [number, number][];
        expect(pts[0]).toEqual([0, 0]);
        expect(pts.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('binds arrows to shapes both ways, with ends on the shape outlines', () => {
    for (const el of elements.filter((e) => e.type === 'arrow')) {
      const pts = el.points as [number, number][];
      const ends: [Binding, [number, number]][] = [
        [el.startBinding as Binding, pts[0]],
        [el.endBinding as Binding, pts[pts.length - 1]],
      ];
      for (const [binding, p] of ends) {
        expect(binding, `arrow ${el.id} binding`).toBeTruthy();
        const target = byId.get(binding.elementId)!;
        expect(target, `arrow ${el.id} target`).toBeTruthy();
        expect(BINDABLE.has(target.type)).toBe(true);
        expect((target.boundElements as Bound[]).some((b) => b.id === el.id && b.type === 'arrow')).toBe(true);
        // The end sits just outside the target's outline, no further than gap + 1 away.
        const ax = (el.x as number) + p[0];
        const ay = (el.y as number) + p[1];
        expect(outline(target, ax, ay, binding.gap + 1), `arrow ${el.id} end near ${target.id}`).toBeLessThanOrEqual(1 + 1e-9);
        expect(outline(target, ax, ay, -1), `arrow ${el.id} end outside ${target.id}`).toBeGreaterThanOrEqual(1);
      }
      expect(el.startBinding).not.toEqual(el.endBinding);
    }
  });

  it('keeps every boundElements entry and container link consistent', () => {
    for (const el of elements) {
      for (const b of el.boundElements as Bound[]) {
        const other = byId.get(b.id)!;
        expect(other, `${el.id} → ${b.id}`).toBeTruthy();
        expect(other.type).toBe(b.type);
        if (b.type === 'text') expect(other.containerId).toBe(el.id);
        else expect([(other.startBinding as Binding)?.elementId, (other.endBinding as Binding)?.elementId]).toContain(el.id);
      }
      if (el.type === 'text' && el.containerId) {
        const c = byId.get(el.containerId as string)!;
        expect((c.boundElements as Bound[]).filter((b) => b.type === 'text').map((b) => b.id)).toEqual([el.id]);
        expect(elements.indexOf(c)).toBeLessThan(elements.indexOf(el));
      }
    }
  });

  it('is deterministic for a seed and unique across builds', () => {
    const again = template.build({ random: seededRandom(42), now: 1_700_000_000_000 });
    expect(again.elements).toEqual(elements);
    const fresh = template.build();
    expect(fresh.elements.some((e) => byId.has(e.id))).toBe(false);
  });
});
