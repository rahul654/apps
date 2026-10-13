// Smoke test: every tool (and each sub-mode) renders without throwing.
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Home } from '../pages/Home';
import Base64Tool from './Base64Tool';
import ConvertersTool from './ConvertersTool';
import CronTool from './CronTool';
import DiffTool from './DiffTool';
import HashTool from './HashTool';
import JsonTool from './JsonTool';
import JwtTool from './JwtTool';
import RegexTool from './RegexTool';
import TimestampTool from './TimestampTool';
import UrlTool from './UrlTool';
import UuidTool from './UuidTool';
import { TOOLS, toolPath } from './registry';

const COMPONENTS: Record<string, () => React.JSX.Element> = {
  json: JsonTool,
  base64: Base64Tool,
  url: UrlTool,
  jwt: JwtTool,
  timestamp: TimestampTool,
  regex: RegexTool,
  cron: CronTool,
  uuid: UuidTool,
  hash: HashTool,
  diff: DiffTool,
  converters: ConvertersTool,
};

const render = (path: string, id: string) => {
  const C = COMPONENTS[id];
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={`/${id}/*`} element={<C />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('tool pages render', () => {
  it('has a component for every registry entry', () => {
    expect(Object.keys(COMPONENTS).sort()).toEqual(TOOLS.map((t) => t.id).sort());
  });
  for (const t of TOOLS) {
    for (const sub of t.sub ?? [{ path: '', name: t.name }]) {
      it(`${toolPath(t, sub.path)}`, () => {
        const html = render(toolPath(t, sub.path), t.id);
        expect(html).toContain('<h1>');
      });
    }
  }
  it('home grid lists every tool', () => {
    const html = renderToString(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    for (const t of TOOLS) expect(html).toContain(t.name);
  });
});
