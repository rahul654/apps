/** Body, auth and script editors for a request / folder / collection. */
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { getFile, setFile } from '../lib/files';
import { prettifyJsonText, validateJsonText } from '../lib/jsonText';
import { eventCode, setEventCode } from '../lib/postman/edit';
import type { PmAuth, PmAuthAttribute, PmAuthType, PmBody, PmEvent, PmFormParam } from '../lib/postman/types';
import { useAppStore } from '../store/AppStore';
import { CodeEditor, type CodeLanguage } from './code/CodeEditor';
import { IconEye, IconEyeOff } from './Icons';
import { KVEditor, type KVRow } from './ui';
import { VarInput } from './vars/VarInput';

const RAW_LANGUAGES: { id: string; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'Text' },
  { id: 'xml', label: 'XML' },
  { id: 'html', label: 'HTML' },
  { id: 'javascript', label: 'JavaScript' },
];

export function codeLanguage(lang: string | undefined): CodeLanguage {
  return lang === 'json' || lang === 'xml' || lang === 'html' || lang === 'javascript' || lang === 'graphql' ? lang : 'text';
}

/** Above this size editors drop highlighting, folding and JSON validation (same limit as the response viewer). */
export const LARGE_TEXT = 1024 * 1024;

export const EDITOR_HINT = 'Tab indents · Esc then Tab leaves the editor · Ctrl+F finds';

/** Height of body editors, from prefs, with a setter that remembers it. */
export function useEditorHeight(): [number, (h: number) => void] {
  const { state, dispatch } = useAppStore();
  return [state.prefs.editorHeight, (h: number) => dispatch({ type: 'prefs/set', prefs: { ...state.prefs, editorHeight: h } })];
}

/** Raw body: CodeMirror with JSON prettify (keeps `{{placeholders}}`) and inline JSON errors that never block sending. */
export function RawBodyEditor({ value, language, onChange, onLanguage, ariaLabel = 'Raw body' }: { value: string; language: string; onChange: (v: string) => void; onLanguage?: (lang: string) => void; ariaLabel?: string }) {
  const [height, setHeight] = useEditorHeight();
  const deferred = useDeferredValue(value);
  // Very large bodies: no highlighting, folding or live validation, so typing stays fast.
  const large = value.length > LARGE_TEXT;
  const jsonErr = useMemo(() => (language === 'json' && !large ? validateJsonText(deferred) : null), [language, deferred, large]);
  const [msg, setMsg] = useState<string | null>(null);
  const prettify = () => {
    const r = prettifyJsonText(value);
    if (r.error) setMsg(`Can’t prettify: fix line ${r.error.line} first.`);
    else {
      setMsg(null);
      if (r.text !== value) onChange(r.text);
    }
  };
  return (
    <div className="stack-sm">
      <div className="row">
        {onLanguage && (
          <label className="row nowrap small">
            <span className="muted">Format</span>
            <select className="input compact" value={language} onChange={(e) => onLanguage(e.target.value)} aria-label="Body format">
              {RAW_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
              {!RAW_LANGUAGES.some((l) => l.id === language) && <option value={language}>{language}</option>}
            </select>
          </label>
        )}
        {language === 'json' && (
          <button type="button" className="btn small" onClick={prettify} disabled={!value.trim()} title="Re-indent the JSON; {{variables}} are kept as written">
            Prettify
          </button>
        )}
        {msg && <span className="tiny warn-text">{msg}</span>}
        <span className="spacer" />
        <span className="tiny muted editor-hint">{EDITOR_HINT}</span>
      </div>
      <CodeEditor value={value} onChange={(v) => {
        setMsg(null);
        onChange(v);
      }} language={codeLanguage(language)} lintJson={language === 'json' && !large} rich={!large} variables ariaLabel={ariaLabel} placeholder={language === 'json' ? '{\n  "key": "{{value}}"\n}' : ''} height={height} onHeightChange={setHeight} />
      {jsonErr && (
        <p className="tiny warn-text json-error" role="status">
          Invalid JSON on line {jsonErr.line}, column {jsonErr.col}: {jsonErr.message}. It will still be sent as written.
        </p>
      )}
    </div>
  );
}

const MODES: { id: PmBody['mode'] | 'none'; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'formdata', label: 'form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'raw', label: 'Raw' },
  { id: 'file', label: 'Binary' },
  { id: 'graphql', label: 'GraphQL' },
];

export function BodyEditor({ body, onChange, itemId }: { body: PmBody | null | undefined; onChange: (b: PmBody | undefined) => void; itemId: string }) {
  const mode = body?.mode ?? 'none';
  const [, rerender] = useState(0);
  const id = useId();
  const set = (patch: Partial<PmBody>) => onChange({ ...(body ?? {}), ...patch });
  const setMode = (m: PmBody['mode'] | 'none') => {
    if (m === 'none') onChange(body ? { ...body, mode: undefined } : undefined);
    else onChange({ ...(body ?? {}), mode: m });
  };
  return (
    <div className="stack-sm">
      <div className="segmented" role="group" aria-label="Body type">
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'raw' && (
        <RawBodyEditor
          value={body?.raw ?? ''}
          language={body?.options?.raw?.language ?? 'text'}
          onChange={(raw) => set({ raw })}
          onLanguage={(language) => set({ options: { ...(body?.options ?? {}), raw: { ...(body?.options?.raw ?? {}), language } } })}
        />
      )}
      {mode === 'urlencoded' && (
        <KVEditor label="URL-encoded fields" rows={(body?.urlencoded ?? []).map((p) => ({ key: p.key, value: p.value ?? '', disabled: p.disabled, description: typeof p.description === 'string' ? p.description : undefined }))} onChange={(rows) => set({ urlencoded: rows.map((r) => ({ key: r.key, value: r.value, type: 'text', ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}) })) })} />
      )}
      {mode === 'formdata' && (
        <FormDataEditor rows={body?.formdata ?? []} itemId={itemId} onChange={(formdata) => set({ formdata })} />
      )}
      {mode === 'file' && (
        <div className="row">
          <label className="btn small" htmlFor={`${id}-file`}>
            Choose file
          </label>
          <input
            id={`${id}-file`}
            className="file-input"
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(itemId, 'file', f);
              set({ file: { src: f?.name ?? null } });
              rerender((n) => n + 1);
            }}
          />
          <span className="small muted">{getFile(itemId, 'file')?.name ?? (body?.file?.src ? `${body.file.src} (pick again after reload)` : 'No file selected')}</span>
        </div>
      )}
      {mode === 'graphql' && <GraphQLEditor value={body?.graphql ?? {}} onChange={(graphql) => set({ graphql })} />}
      {mode === 'none' && <p className="small muted">This request has no body.</p>}
    </div>
  );
}

function GraphQLEditor({ value, onChange }: { value: NonNullable<PmBody['graphql']>; onChange: (g: NonNullable<PmBody['graphql']>) => void }) {
  const [height, setHeight] = useEditorHeight();
  const vars = value.variables ?? '';
  const deferred = useDeferredValue(vars);
  const err = useMemo(() => validateJsonText(deferred), [deferred]);
  return (
    <div className="stack-sm">
      <span className="tiny muted editor-hint">{EDITOR_HINT}</span>
      <div className="script-grid">
        <div className="field">
          <span>Query</span>
          <CodeEditor value={value.query ?? ''} onChange={(query) => onChange({ ...value, query })} language="graphql" variables ariaLabel="GraphQL query" height={height} onHeightChange={setHeight} />
        </div>
        <div className="field">
          <span className="row nowrap">
            Variables (JSON)
            <button type="button" className="btn ghost small" disabled={!vars.trim()} onClick={() => {
              const r = prettifyJsonText(vars);
              if (r.text !== null && r.text !== vars) onChange({ ...value, variables: r.text });
            }}>
              Prettify
            </button>
          </span>
          <CodeEditor value={vars} onChange={(variables) => onChange({ ...value, variables })} language="json" lintJson variables ariaLabel="GraphQL variables" height={height} onHeightChange={setHeight} />
          {err && <p className="tiny warn-text json-error" role="status">Invalid JSON on line {err.line}: {err.message}</p>}
        </div>
      </div>
    </div>
  );
}

function FormDataEditor({ rows, onChange, itemId }: { rows: PmFormParam[]; onChange: (rows: PmFormParam[]) => void; itemId: string }) {
  const [, rerender] = useState(0);
  const update = (i: number, patch: Partial<PmFormParam>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div>
      <table className="kv">
        <caption className="sr-only">Form fields</caption>
        <thead>
          <tr>
            <th className="c"><span className="sr-only">Enabled</span></th>
            <th>Key</th>
            <th>Type</th>
            <th>Value</th>
            <th className="a"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.disabled ? 'off' : undefined}>
              <td className="c"><input type="checkbox" checked={!r.disabled} onChange={(e) => update(i, { disabled: !e.target.checked })} aria-label={`Enable ${r.key || 'field ' + (i + 1)}`} /></td>
              <td><VarInput className="input mono" value={r.key} onChange={(v) => update(i, { key: v })} aria-label={`Field name ${i + 1}`} spellCheck={false} /></td>
              <td>
                <select className="input compact" value={r.type === 'file' ? 'file' : 'text'} onChange={(e) => update(i, { type: e.target.value as 'text' | 'file' })} aria-label={`Field type ${i + 1}`}>
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              </td>
              <td>
                {r.type === 'file' ? (
                  <span className="row nowrap">
                    <label className="btn small">
                      Choose
                      <input className="file-input" type="file" onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setFile(itemId, `formdata:${r.key}`, f);
                        update(i, { src: f?.name ?? null });
                        rerender((n) => n + 1);
                      }} />
                    </label>
                    <span className="tiny muted ellipsis">{getFile(itemId, `formdata:${r.key}`)?.name ?? (typeof r.src === 'string' && r.src ? `${r.src} (pick again)` : 'No file')}</span>
                  </span>
                ) : (
                  <VarInput className="input mono" value={r.value ?? ''} onChange={(v) => update(i, { value: v })} aria-label={`Field value ${i + 1}`} spellCheck={false} />
                )}
              </td>
              <td className="a">
                <button type="button" className="btn ghost small icon" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.key || 'field ' + (i + 1)}`}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn ghost small kv-add" onClick={() => onChange([...rows, { key: '', value: '', type: 'text' }])}>+ Add</button>
    </div>
  );
}

const AUTH_TYPES: { id: PmAuthType | 'inherit'; label: string }[] = [
  { id: 'inherit', label: 'Inherit from parent' },
  { id: 'noauth', label: 'No auth' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'basic', label: 'Basic auth' },
  { id: 'apikey', label: 'API key' },
  { id: 'oauth2', label: 'OAuth 2.0 (token only)' },
];

function attr(auth: PmAuth, key: string): string {
  const list = auth[auth.type] as PmAuthAttribute[] | undefined;
  const v = list?.find((a) => a.key === key)?.value;
  return v === undefined || v === null ? '' : String(v);
}
function withAttr(auth: PmAuth, key: string, value: string): PmAuth {
  const list = [...((auth[auth.type] as PmAuthAttribute[] | undefined) ?? [])];
  const i = list.findIndex((a) => a.key === key);
  if (i >= 0) list[i] = { ...list[i], value };
  else list.push({ key, value, type: 'string' });
  return { ...auth, [auth.type]: list };
}

/** One auth value. Secrets are masked (with a reveal toggle) unless they are a `{{variable}}` reference. */
function AuthField({ label, value, secret, onChange }: { label: string; value: string; secret: boolean; onChange: (v: string) => void }) {
  const [reveal, setReveal] = useState(false);
  const id = useId();
  const masked = secret && !reveal && !value.includes('{{');
  return (
    <div className="field">
      <label htmlFor={id}>
        <span className="field-label">{label}</span>
      </label>
      <div className="row nowrap">
        <VarInput id={id} className="input mono" wrapperClassName="grow" type={masked ? 'password' : 'text'} value={value} onChange={onChange} spellCheck={false} autoComplete="off" />
        {secret && (
          <button type="button" className="btn ghost small icon" aria-label={reveal ? `Hide ${label}` : `Show ${label}`} aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
            {reveal ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          </button>
        )}
      </div>
    </div>
  );
}

/** `auth === undefined` means inherit; `null`/noauth means none. */
export function AuthEditor({ auth, onChange, allowInherit = true }: { auth: PmAuth | null | undefined; onChange: (a: PmAuth | null | undefined) => void; allowInherit?: boolean }) {
  const type: PmAuthType | 'inherit' = auth === undefined ? (allowInherit ? 'inherit' : 'noauth') : auth === null ? 'noauth' : auth.type;
  const known = AUTH_TYPES.some((t) => t.id === type);
  const setType = (t: string) => {
    if (t === 'inherit') onChange(undefined);
    else if (t === 'noauth') onChange({ type: 'noauth' });
    else if (auth && auth.type === t) onChange(auth);
    else onChange({ type: t as PmAuthType, [t]: [] });
  };
  const field = (key: string, label: string, secret = false) => <AuthField key={key} label={label} secret={secret} value={auth ? attr(auth, key) : ''} onChange={(v) => auth && onChange(withAttr(auth, key, v))} />;
  return (
    <div className="stack-sm">
      <label className="field self-start">
        <span>Type</span>
        <select className="input compact" value={type} onChange={(e) => setType(e.target.value)}>
          {AUTH_TYPES.filter((t) => allowInherit || t.id !== 'inherit').map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
          {!known && <option value={type}>{type} (kept as imported)</option>}
        </select>
      </label>
      {type === 'bearer' && field('token', 'Token', true)}
      {type === 'basic' && (
        <div className="grid-2">
          {field('username', 'Username')}
          {field('password', 'Password', true)}
        </div>
      )}
      {type === 'apikey' && (
        <div className="grid-2">
          {field('key', 'Key (header or param name)')}
          {field('value', 'Value', true)}
          <label className="field">
            <span>Add to</span>
            <select className="input compact" value={auth ? attr(auth, 'in') || 'header' : 'header'} onChange={(e) => auth && onChange(withAttr(auth, 'in', e.target.value))}>
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </select>
          </label>
        </div>
      )}
      {type === 'oauth2' && (
        <>
          <p className="small muted">Token flows (authorization code, client credentials…) are not run here. Paste an access token; every other OAuth field is kept for Postman.</p>
          <div className="grid-2">
            {field('accessToken', 'Access token', true)}
            {field('headerPrefix', 'Header prefix (default Bearer)')}
          </div>
        </>
      )}
      {!known && auth && <pre className="codeview small">{JSON.stringify(auth, null, 2)}</pre>}
      {type === 'inherit' && <p className="small muted">Uses the auth of the enclosing folder or collection.</p>}
    </div>
  );
}

const SNIPPETS: { label: string; code: string; kind: 'prerequest' | 'test' }[] = [
  { kind: 'test', label: 'Status is 200', code: "pm.test('Status is 200', () => {\n  pm.response.to.have.status(200);\n});" },
  { kind: 'test', label: 'JSON value check', code: "pm.test('Has id', () => {\n  const body = pm.response.json();\n  pm.expect(body.id).to.be.a('number');\n});" },
  { kind: 'test', label: 'Set env from response', code: "pm.environment.set('token', pm.response.json().token);" },
  { kind: 'test', label: 'Response time', code: "pm.test('Fast', () => pm.expect(pm.response.responseTime).to.be.below(500));" },
  { kind: 'test', label: 'Next request', code: "postman.setNextRequest('Request name');" },
  { kind: 'prerequest', label: 'Set variable', code: "pm.variables.set('ts', Date.now());" },
  { kind: 'prerequest', label: 'Add header', code: "pm.request.headers.add({ key: 'X-Trace', value: pm.variables.replaceIn('{{$guid}}') });" },
  { kind: 'prerequest', label: 'sendRequest', code: "pm.sendRequest({ url: pm.environment.get('baseUrl') + '/token', method: 'POST' }, (err, res) => {\n  if (!err) pm.environment.set('token', res.json().token);\n});" },
];

export function ScriptsEditor({ events, onChange }: { events: PmEvent[] | undefined; onChange: (e: PmEvent[] | undefined) => void }) {
  const pre = eventCode(events, 'prerequest');
  const test = eventCode(events, 'test');
  const Block = ({ kind, value, label }: { kind: 'prerequest' | 'test'; value: string; label: string }) => (
    <div className="field">
      <span>{label}</span>
      <textarea className="input code" value={value} onChange={(e) => onChange(setEventCode(events, kind, e.target.value))} spellCheck={false} aria-label={label} placeholder={kind === 'test' ? "pm.test('…', () => { … })" : '// runs before the request is sent'} />
      <div className="snippets">
        {SNIPPETS.filter((s) => s.kind === kind).map((s) => (
          <button key={s.label} type="button" className="btn ghost small" onClick={() => onChange(setEventCode(events, kind, value ? `${value}\n${s.code}` : s.code))}>
            + {s.label}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="script-grid">
      <Block kind="prerequest" value={pre} label="Pre-request script" />
      <Block kind="test" value={test} label="Post-response script (tests)" />
    </div>
  );
}

export function headersToRows(h: { key: string; value: string; disabled?: boolean; description?: unknown }[]): KVRow[] {
  return h.map((x) => ({ key: x.key, value: x.value ?? '', disabled: x.disabled, description: typeof x.description === 'string' ? x.description : undefined }));
}
