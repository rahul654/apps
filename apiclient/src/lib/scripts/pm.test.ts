import { describe, expect, it } from 'vitest';
import { createInProcessRunner, payload } from './node-env';

describe('pm sandbox runtime', () => {
  const run = createInProcessRunner(async (req) => {
    if (req.url.includes('fail')) return { code: 0, status: '', headers: [], body: '', responseTime: 0, error: 'boom' };
    return { code: 201, status: 'Created', headers: [{ key: 'x-echo', value: req.method }], body: JSON.stringify({ url: req.url, body: req.body }), responseTime: 3 };
  });

  it('records passing and failing tests with chai expect', async () => {
    const r = await run(
      payload(`
      pm.test('status ok', () => pm.response.to.have.status(200));
      pm.test('json a', () => pm.expect(pm.response.json().a).to.eql(1));
      pm.test('fails', () => pm.expect(pm.response.json().a).to.eql(2));
      pm.test('header', () => pm.response.to.have.header('content-type', 'application/json'));
      pm.test('be ok', () => pm.response.to.be.ok);
      pm.test('not status', () => pm.response.to.not.have.status(500));
      pm.test('jsonBody', () => pm.response.to.have.jsonBody('list[1]', 2));
      pm.test('text', () => pm.expect(pm.response.text()).to.include('"a":1'));
    `),
    );
    expect(r.error).toBeUndefined();
    expect(r.tests.map((t) => [t.name, t.passed])).toEqual([
      ['status ok', true],
      ['json a', true],
      ['fails', false],
      ['header', true],
      ['be ok', true],
      ['not status', true],
      ['jsonBody', true],
      ['text', true],
    ]);
    expect(r.tests[2].error).toMatch(/expected 1 to deeply equal 2/);
  });

  it('sets, unsets and reads variables across scopes with Postman precedence', async () => {
    const r = await run(
      payload(
        `
      pm.environment.set('token', 'abc');
      pm.globals.set('g', 1);
      pm.collectionVariables.set('c', {a:1});
      pm.variables.set('l', 'local');
      pm.environment.unset('gone');
      console.log('order', pm.variables.get('shared'), pm.variables.replaceIn('{{shared}}/{{l}}'));
      pm.test('env get', () => pm.expect(pm.environment.get('token')).to.eql('abc'));
      pm.test('has', () => pm.expect(pm.environment.has('token')).to.be.true);
      pm.test('data', () => pm.expect(pm.iterationData.get('row')).to.eql('r1'));
    `,
        { variables: { globals: { shared: 'global', gone: 'x' }, environment: { gone: 'y', shared: 'env' }, collection: { shared: 'col' }, local: {}, data: { row: 'r1', shared: 'data' } } },
      ),
    );
    expect(r.error).toBeUndefined();
    expect(r.variables.environment).toEqual({ shared: 'env', token: 'abc' });
    expect(r.variables.globals).toEqual({ shared: 'global', gone: 'x', g: '1' });
    expect(r.variables.collection).toEqual({ shared: 'col', c: '{"a":1}' });
    expect(r.variables.local).toEqual({ l: 'local' });
    expect(r.console[0].args).toEqual(['order', 'data', 'data/local']);
    expect(r.tests.every((t) => t.passed)).toBe(true);
  });

  it('supports setNextRequest in both spellings, including null to stop', async () => {
    expect((await run(payload(`postman.setNextRequest('Login')`))).nextRequest).toBe('Login');
    expect((await run(payload(`pm.execution.setNextRequest(null)`))).nextRequest).toBeNull();
    expect((await run(payload(`1+1`))).nextRequest).toBeUndefined();
  });

  it('lets pre-request scripts edit the outgoing request', async () => {
    const r = await run(
      payload(`pm.request.headers.add({key:'X-A', value:'1'}); pm.request.headers.upsert({key:'Accept', value:'text/plain'}); pm.request.headers.remove('X-Old'); pm.request.url = pm.request.url.toString() + '?x=1'; pm.request.method = 'post';`, {
        kind: 'prerequest',
        response: undefined,
        request: { method: 'GET', url: 'https://e.com/a', headers: [{ key: 'Accept', value: 'application/json' }, { key: 'X-Old', value: '1' }], body: null, name: 'R', id: 'r' },
      }),
    );
    expect(r.error).toBeUndefined();
    expect(r.request).toMatchObject({ method: 'POST', url: 'https://e.com/a?x=1', headers: [{ key: 'Accept', value: 'text/plain' }, { key: 'X-A', value: '1' }] });
  });

  it('pm.sendRequest goes through the host and waits for the callback', async () => {
    const r = await run(
      payload(`
      pm.sendRequest({ url: 'https://api/{{host}}', method: 'POST', header: { 'X-T': '1' }, body: { mode: 'raw', raw: 'hi' } }, (err, res) => {
        pm.test('cb status', () => pm.expect(res.code).to.eql(201));
        pm.environment.set('fromCb', res.json().url);
        pm.test('cb header', () => pm.expect(res.headers.get('x-echo')).to.eql('POST'));
      });
      pm.sendRequest('https://fail', (err) => { pm.test('err', () => pm.expect(err.message).to.eql('boom')); });
    `, { variables: { globals: {}, environment: { host: 'h1' }, collection: {}, local: {}, data: {} } }),
    );
    expect(r.error).toBeUndefined();
    expect(r.variables.environment.fromCb).toBe('https://api/h1');
    expect(r.tests.map((t) => t.passed)).toEqual([true, true, true]);
  });

  it('awaits async tests and top-level promises', async () => {
    const r = await run(payload(`pm.test('async', async () => { await new Promise(r => setTimeout(r, 5)); pm.expect(1).to.eql(2); }); pm.test('sync', () => {});`));
    expect(r.tests).toEqual([{ name: 'async', passed: false, error: 'expected 1 to deeply equal 2' }, { name: 'sync', passed: true }]);
  });

  it('reports uncaught errors and keeps earlier results', async () => {
    const r = await run(payload(`pm.test('one', () => {}); console.warn('w', {a:1}); throw new TypeError('bad');`));
    expect(r.error).toBe('TypeError: bad');
    expect(r.tests).toEqual([{ name: 'one', passed: true }]);
    expect(r.console).toEqual([{ level: 'warn', args: ['w', '{\n  "a": 1\n}'] }]);
  });

  it('supports the legacy tests[] / responseBody API', async () => {
    const r = await run(payload(`tests['legacy ok'] = responseCode.code === 200; tests['legacy bad'] = responseBody.length === 0; postman.setEnvironmentVariable('k', 'v');`));
    expect(r.tests).toEqual([{ name: 'legacy ok', passed: true }, { name: 'legacy bad', passed: false }]);
    expect(r.variables.environment.k).toBe('v');
  });

  it('times out a script that never settles', async () => {
    const r = await run(payload(`pm.test('never', () => new Promise(() => {}));`, { timeout: 30 }));
    expect(r.error).toMatch(/timed out/);
  });
});
