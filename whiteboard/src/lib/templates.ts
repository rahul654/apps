import { FILL, FONT, SceneBuilder, type Point } from './elements';
import type { SavedAppState, SceneElement } from './types';

export interface TemplateScene {
  elements: SceneElement[];
  appState: SavedAppState;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  emoji: string;
  build: (opts?: { random?: () => number; now?: number }) => TemplateScene;
}

const APP_STATE: SavedAppState = { viewBackgroundColor: '#ffffff' };

function flowchart(b: SceneBuilder) {
  b.text(300, 0, 'Flowchart', { fontSize: 28, align: 'center' });
  const start = b.shape('ellipse', 220, 60, 160, 70, { label: 'Start', fill: FILL.green });
  const input = b.shape('rectangle', 190, 190, 220, 80, { label: 'Collect input', fill: FILL.blue });
  const check = b.shape('diamond', 200, 330, 200, 130, { label: 'Valid?', fill: FILL.yellow });
  const process = b.shape('rectangle', 190, 520, 220, 80, { label: 'Process', fill: FILL.blue });
  const end = b.shape('ellipse', 220, 660, 160, 70, { label: 'Done', fill: FILL.green });
  const fix = b.shape('rectangle', 490, 355, 200, 80, { label: 'Show error', fill: FILL.orange });
  b.arrow(start, input);
  b.arrow(input, check);
  b.arrow(check, process, { label: 'Yes' });
  b.arrow(process, end);
  b.arrow(check, fix, { label: 'No' });
  b.arrow(fix, input, { start: 'top', end: 'right', via: [[590, 230]] });
}

function swimlane(b: SceneBuilder) {
  b.text(0, -60, 'Order process', { fontSize: 28 });
  const lanes = ['Customer', 'Sales', 'Warehouse'];
  const fills = [FILL.lightGray, '#ffffff', FILL.lightGray];
  lanes.forEach((name, i) => {
    b.shape('rectangle', 0, i * 180, 140, 180, { label: name, fill: FILL.gray, rounded: false, fontSize: 20 });
    b.shape('rectangle', 140, i * 180, 1100, 180, { fill: fills[i], rounded: false, stroke: '#adb5bd' });
  });
  const step = (x: number, lane: number, label: string, fill: string = FILL.blue) => b.shape('rectangle', x, lane * 180 + 55, 160, 70, { label, fill, fontSize: 18 });
  const order = step(180, 0, 'Place order', FILL.violet);
  const review = step(380, 1, 'Check order');
  const stock = b.shape('diamond', 590, 215, 150, 110, { label: 'In stock?', fill: FILL.yellow, fontSize: 18 });
  const backorder = step(820, 1, 'Back-order', FILL.orange);
  const pick = step(585, 2, 'Pick & pack');
  const ship = step(820, 2, 'Ship');
  const receive = step(1020, 0, 'Receive order', FILL.green);
  b.arrow(order, review, { start: 'right', end: 'top', via: [[460, 90]] });
  b.arrow(review, stock);
  b.arrow(stock, pick, { label: 'Yes' });
  b.arrow(stock, backorder, { label: 'No' });
  b.arrow(pick, ship);
  b.arrow(ship, receive, { start: 'right', end: 'bottom', via: [[1100, 450]] });
}

function mindmap(b: SceneBuilder) {
  const hub = b.shape('ellipse', 390, 250, 220, 100, { label: 'Main idea', fill: FILL.violet, fontSize: 24 });
  const branches: [number, number, string, string, [string, string]][] = [
    [100, 120, 'Goals', FILL.blue, ['Grow users', 'Ship v2']],
    [100, 420, 'Risks', FILL.orange, ['Timeline', 'Budget']],
    [730, 120, 'Ideas', FILL.green, ['Templates', 'Dark mode']],
    [730, 420, 'Next steps', FILL.yellow, ['Draft plan', 'Review Friday']],
  ];
  for (const [x, y, label, fill, leaves] of branches) {
    const node = b.shape('rectangle', x, y, 170, 60, { label, fill });
    b.arrow(hub, node, { endArrowhead: null });
    const leafX = x < 400 ? -130 : 970;
    leaves.forEach((leaf, i) => {
      const n = b.shape('rectangle', leafX, y - 50 + i * 110, 150, 50, { label: leaf, fontSize: 16, strokeStyle: 'dashed' });
      b.arrow(node, n, { endArrowhead: null });
    });
  }
}

function kanban(b: SceneBuilder) {
  b.text(0, -70, 'Team board', { fontSize: 32 });
  const columns: [string, string, string[]][] = [
    ['To do', FILL.yellow, ['Write brief', 'Collect feedback', 'Plan sprint']],
    ['In progress', FILL.blue, ['Design review', 'Fix login bug']],
    ['Done', FILL.green, ['Kick-off call', 'Set up repo']],
  ];
  columns.forEach(([name, fill, cards], i) => {
    const x = i * 300;
    b.shape('rectangle', x, 0, 270, 560, { fill: FILL.lightGray, stroke: '#ced4da' });
    b.text(x + 18, 18, `${name} (${cards.length})`, { fontSize: 22 });
    cards.forEach((card, j) => {
      b.shape('rectangle', x + 15, 70 + j * 110, 240, 90, { label: card, fill, fontSize: 18 });
    });
  });
}

function wireframe(b: SceneBuilder) {
  b.fontFamily = FONT.nunito;
  b.shape('rectangle', 0, 0, 900, 600, { fill: '#ffffff' });
  b.shape('rectangle', 0, 0, 900, 44, { fill: FILL.gray, rounded: false });
  [FILL.pink, FILL.yellow, FILL.green].forEach((fill, i) => b.shape('ellipse', 16 + i * 20, 16, 12, 12, { fill, strokeWidth: 1 }));
  b.shape('rectangle', 90, 10, 520, 24, { label: 'https://example.com', fill: '#ffffff', fontSize: 14, textAlign: 'left', strokeWidth: 1 });
  b.text(28, 62, 'Logo', { fontSize: 26 });
  ['Product', 'Pricing', 'Sign in'].forEach((t, i) => b.text(600 + i * 95, 70, t, { fontSize: 16 }));
  b.text(40, 140, 'Big headline here', { fontSize: 36 });
  b.text(40, 200, 'A short sentence that explains\nwhat this page offers.', { fontSize: 18, color: '#495057' });
  b.shape('rectangle', 40, 280, 170, 50, { label: 'Get started', fill: FILL.blue, fontSize: 18 });
  const img = b.shape('rectangle', 480, 120, 380, 230, { fill: FILL.lightGray, rounded: false, strokeWidth: 1 });
  const corners: Point[][] = [
    [[480, 120], [860, 350]],
    [[860, 120], [480, 350]],
  ];
  for (const pts of corners) b.line(pts, { stroke: '#adb5bd', strokeWidth: 1 });
  b.group(img);
  ['Feature one', 'Feature two', 'Feature three'].forEach((t, i) => {
    b.shape('rectangle', 40 + i * 285, 390, 250, 170, {
      label: `${t}\nA line or two about it.`,
      fontSize: 16,
      textAlign: 'left',
      verticalAlign: 'top',
      strokeWidth: 1,
    });
  });
}

const make =
  (fn: (b: SceneBuilder) => void): Template['build'] =>
  (opts = {}) => {
    const b = new SceneBuilder(opts);
    fn(b);
    return { elements: b.elements, appState: { ...APP_STATE } };
  };

export const TEMPLATES: readonly Template[] = [
  { id: 'flowchart', name: 'Flowchart', emoji: '🔀', description: 'Start, steps, a decision and a loop back.', build: make(flowchart) },
  { id: 'swimlane', name: 'Swimlane', emoji: '🏊', description: 'A process across three lanes of responsibility.', build: make(swimlane) },
  { id: 'mindmap', name: 'Mind map', emoji: '🧠', description: 'A central idea with branches and leaves.', build: make(mindmap) },
  { id: 'kanban', name: 'Kanban', emoji: '🗂️', description: 'To do, in progress and done columns with cards.', build: make(kanban) },
  { id: 'wireframe', name: 'Wireframe', emoji: '🖥️', description: 'A landing page sketch in a browser window.', build: make(wireframe) },
];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
