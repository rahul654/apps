import { useEffect, useMemo, useState } from 'react';
import { CodeArea } from '../components/CodeArea';
import { Field, Notice } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { ToolPage } from '../components/ToolPage';
import { useMemoryState } from '../hooks/memoryState';
import { useDebounced } from '../hooks/useDebounced';
import { decodeJwt, isHmacAlg, jwtStatus, secretBytes, signHmacJwt, timeClaims, verifyHmacJwt, type SecretEncoding } from '../lib/jwt';
import { utf8Encode } from '../lib/base64';
import { relativeTime } from '../lib/time';

const SAMPLE_SECRET = 'your-256-bit-secret';

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

type Verify = { state: 'idle' } | { state: 'ok' } | { state: 'bad' } | { state: 'error'; message: string };

export default function JwtTool() {
  const [token, setToken] = useMemoryState('jwt:token', '');
  const [secret, setSecret] = useMemoryState('jwt:secret', '');
  const [encoding, setEncoding] = useState<SecretEncoding>('utf8');
  const [showSecret, setShowSecret] = useState(false);
  const [verify, setVerify] = useState<Verify>({ state: 'idle' });
  const now = useNow();

  const decoded = useMemo(() => {
    if (!token.trim()) return null;
    try {
      return { jwt: decodeJwt(token) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [token]);
  const jwt = decoded && 'jwt' in decoded ? decoded.jwt : undefined;

  const debouncedSecret = useDebounced(secret, 200);
  useEffect(() => {
    if (!jwt || !debouncedSecret) {
      setVerify({ state: 'idle' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ok = await verifyHmacJwt(token, secretBytes(debouncedSecret, encoding));
        if (!cancelled) setVerify({ state: ok ? 'ok' : 'bad' });
      } catch (e) {
        if (!cancelled) setVerify({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jwt, token, debouncedSecret, encoding]);

  const loadSample = async () => {
    const iat = Math.floor(Date.now() / 1000);
    const t = await signHmacJwt({ sub: '1234567890', name: 'Ada Lovelace', role: 'admin', iat, exp: iat + 3600 }, utf8Encode(SAMPLE_SECRET));
    setToken(t);
    setSecret(SAMPLE_SECRET);
    setEncoding('utf8');
  };

  const headerJson = jwt ? JSON.stringify(jwt.header, null, 2) : '';
  const payloadJson = jwt ? (jwt.payload ? JSON.stringify(jwt.payload, null, 2) : jwt.payloadText) : '';
  const status = jwt?.payload ? jwtStatus(jwt.payload, now) : null;
  const alg = jwt?.header.alg;

  return (
    <ToolPage title="JWT decoder" icon="JWT" description="Decode a JSON Web Token, check its time claims and optionally verify an HMAC signature.">
      <Notice kind="warn" title="Decoding is not verification.">
        Anyone can create a token with any payload. The signature is only checked when you enter the secret below (HS256/384/512).
      </Notice>
      <CodeArea
        label="Token"
        value={token}
        onChange={setToken}
        onSample={loadSample}
        onClear={() => {
          setToken('');
          setSecret('');
        }}
        rows={5}
        placeholder="eyJhbGciOi… (a leading “Bearer ” is fine)"
        invalid={!!decoded && !jwt}
        footer={
          jwt ? (
            <span className="jwt-colored mono" aria-label="Token parts: header, payload, signature">
              <span className="jwt-h">{jwt.parts[0].slice(0, 24)}…</span>.<span className="jwt-p">{jwt.parts[1].slice(0, 24)}…</span>.<span className="jwt-s">{jwt.parts[2].slice(0, 16) || '(no signature)'}</span>
            </span>
          ) : undefined
        }
      />
      {decoded && 'error' in decoded && <Notice kind="error">{decoded.error}</Notice>}
      {jwt && (
        <>
          {status && (
            <Notice kind={status.state === 'valid' ? 'ok' : status.state === 'no-expiry' ? 'info' : 'error'} title={status.state === 'expired' ? 'Expired.' : status.state === 'not-yet-valid' ? 'Not yet valid.' : undefined}>
              {status.message}
            </Notice>
          )}
          <div className="panes">
            <CodeArea label={`Header${typeof alg === 'string' ? ` · ${alg}` : ''}`} value={headerJson} rows={8} className="jwt-header-area" />
            <CodeArea label={jwt.payload ? 'Payload' : 'Payload (not JSON)'} value={payloadJson} rows={8} className="jwt-payload-area" />
          </div>

          {timeClaims(jwt.payload).length > 0 && (
            <section className="card" aria-labelledby="claims-h">
              <h2 id="claims-h" className="card-title">
                Time claims
              </h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Claim</th>
                      <th scope="col">Value</th>
                      <th scope="col">Local time</th>
                      <th scope="col">UTC</th>
                      <th scope="col">Relative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeClaims(jwt.payload).map((c) => (
                      <tr key={c.claim}>
                        <td>
                          <code>{c.claim}</code> <span className="muted">{c.label}</span>
                        </td>
                        <td className="mono">{c.seconds}</td>
                        <td>{Number.isFinite(new Date(c.ms).getTime()) ? new Date(c.ms).toLocaleString() : '—'}</td>
                        <td className="mono">{Number.isFinite(new Date(c.ms).getTime()) ? new Date(c.ms).toISOString() : '—'}</td>
                        <td>{relativeTime(c.ms, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card" aria-labelledby="verify-h">
            <h2 id="verify-h" className="card-title">
              Verify signature
            </h2>
            {!isHmacAlg(alg) ? (
              <Notice kind="info">
                This token uses <code>{String(alg ?? 'no alg')}</code>. Only HS256, HS384 and HS512 can be verified here; for RS/ES/PS tokens use your identity provider's public key with a server-side library.
              </Notice>
            ) : (
              <>
                <div className="row">
                  <Field label="Secret" className="grow">
                    {(id) => (
                      <div className="input-with-btn">
                        <input id={id} type={showSecret ? 'text' : 'password'} className="mono" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder="HMAC secret" />
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowSecret(!showSecret)} aria-pressed={showSecret}>
                          {showSecret ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    )}
                  </Field>
                  <Field label="Secret encoding">
                    {(id) => (
                      <select id={id} value={encoding} onChange={(e) => setEncoding(e.target.value as SecretEncoding)}>
                        <option value="utf8">UTF-8 text</option>
                        <option value="base64">Base64 / Base64url</option>
                      </select>
                    )}
                  </Field>
                </div>
                <div aria-live="polite">
                  {verify.state === 'idle' && <Notice kind="info">Signature not verified. Enter the secret to check it.</Notice>}
                  {verify.state === 'ok' && <Notice kind="ok" title="Signature verified.">The token was signed with this secret ({String(alg)}).</Notice>}
                  {verify.state === 'bad' && <Notice kind="error" title="Invalid signature.">The token was not signed with this secret, or it has been modified.</Notice>}
                  {verify.state === 'error' && <Notice kind="error">{verify.message}</Notice>}
                </div>
              </>
            )}
            <div className="row">
              <span className="muted small">Signature (base64url):</span>
              <code className="mono small break">{jwt.signature || '(empty)'}</code>
              <CopyButton text={jwt.signature} ariaLabel="Copy signature" />
            </div>
          </section>
        </>
      )}
    </ToolPage>
  );
}
