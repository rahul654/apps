import assert from 'node:assert/strict';
import { test } from 'node:test';
import { injectGate } from './inject.mjs';

const vitePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Splitwise</title>
    <script>
      try { var t = localStorage.getItem('x:theme'); } catch (e) {}
    </script>
    <script type="module" crossorigin src="./assets/index-DWUE7-Am.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/vendor-abc.js">
    <link rel="stylesheet" crossorigin href="./assets/index-K3GS1Ffl.css">
  </head>
  <body>
    <div id="root"></div>
    <script type='module'>console.log(1)</script>
    <script TYPE=module src="./b.js"></script>
  </body>
</html>`;

test('adds the hiding style and gate script at the start of <head>', () => {
  const out = injectGate(vitePage, '../gate/');
  const head = out.indexOf('<head>') + '<head>'.length;
  const style = out.indexOf('<style data-apps-gate>');
  const gate = out.indexOf('<script data-apps-gate type="module" src="../gate/auth-gate.js"></script>');
  assert.ok(style > head && style < out.indexOf('<meta charset'));
  assert.ok(gate > style && gate < out.indexOf('<meta charset'));
  assert.match(out, /html:not\(\[data-gate="open"\]\) body\{visibility:hidden!important\}/);
});

test('makes every app module script inert and keeps its attributes', () => {
  const out = injectGate(vitePage, '../gate/');
  assert.ok(out.includes('<script type="text/x-gated-module" crossorigin src="./assets/index-DWUE7-Am.js"></script>'));
  assert.ok(out.includes('<script type="text/x-gated-module">console.log(1)</script>'));
  assert.ok(out.includes('<script type="text/x-gated-module" src="./b.js"></script>'));
  // Only the gate itself is still a module script.
  assert.equal(out.match(/type=["']?module/gi).length, 1);
  // Classic scripts (theme before first paint) and preloads are left alone.
  assert.ok(out.includes("<script>\n      try { var t = localStorage.getItem('x:theme'); }"));
  assert.ok(out.includes('<link rel="modulepreload" crossorigin href="./assets/vendor-abc.js">'));
});

test('works on a page without module scripts (the landing page)', () => {
  const page = '<!doctype html><html><head lang="en"><title>Apps</title></head><body><ul></ul></body></html>';
  const out = injectGate(page, './gate/');
  assert.ok(out.startsWith('<!doctype html><html><head lang="en">\n    <style data-apps-gate>'));
  assert.ok(out.includes('src="./gate/auth-gate.js"'));
});

test('refuses a page twice and a page without <head>', () => {
  assert.throws(() => injectGate(injectGate(vitePage, './gate/'), './gate/'), /already/);
  assert.throws(() => injectGate('<html><body></body></html>', './gate/'), /no <head>/);
});
