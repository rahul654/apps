import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { duplicateSandbox } from '../lib/defaults';
import { allowAttr, effectiveTokens, FEATURES, PRESET_IDS, PRESETS, presetOf, REFERRERS, supportsCredentialless, TOKENS } from '../lib/policy';
import { useSandboxes } from '../store/SandboxStore';
import type { FeatureName, Sandbox, SandboxToken } from '../types';
import { IconAlert, IconClose, IconCopy, IconTrash } from './Icons';
import { useRemoveSandbox } from './Layout';

export function PresetPicker({ tokens, onChange, label = 'Isolation' }: { tokens: SandboxToken[]; onChange: (t: SandboxToken[]) => void; label?: string }) {
  const current = presetOf(tokens);
  return (
    <div className="stack-sm">
      <div className="row">
        <span className="field-label">{label}</span>
        {current === 'custom' && <span className="pill">Custom</span>}
      </div>
      <div className="segmented" role="group" aria-label={label}>
        {PRESET_IDS.map((id) => (
          <button key={id} type="button" aria-pressed={current === id} onClick={() => onChange([...PRESETS[id].tokens])}>
            {PRESETS[id].label}
          </button>
        ))}
      </div>
      <p className="muted small">{current === 'custom' ? 'Your own mix of permissions, below.' : PRESETS[current].help}</p>
    </div>
  );
}

export function SettingsPanel({ sb, onClose }: { sb: Sandbox; onClose: () => void }) {
  const { dispatch } = useSandboxes();
  const navigate = useNavigate();
  const remove = useRemoveSandbox();
  const update = (patch: Partial<Sandbox>) => dispatch({ type: 'update', id: sb.id, patch });
  const [name, setName] = useState(sb.name);
  const [prevName, setPrevName] = useState(sb.name);
  if (prevName !== sb.name) {
    setPrevName(sb.name);
    setName(sb.name);
  }

  const eff = effectiveTokens(sb, window.location.origin);
  const toggleToken = (t: SandboxToken, on: boolean) => update({ tokens: on ? [...sb.tokens, t] : sb.tokens.filter((x) => x !== t) });
  const toggleFeature = (f: FeatureName, on: boolean) => update({ features: on ? [...sb.features, f] : sb.features.filter((x) => x !== f) });
  const clSupported = supportsCredentialless();
  const allow = allowAttr(sb.features);

  return (
    <aside className="settings" aria-label="Sandbox settings">
      <div className="settings-head">
        <h2>Settings</h2>
        <button type="button" className="btn ghost icon small" onClick={onClose} aria-label="Close settings">
          <IconClose size={16} />
        </button>
      </div>

      <div className="settings-body">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== sb.name && update({ name })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder={sb.kind === 'web' ? 'Follows the site name' : 'HTML playground'}
          />
        </label>

        <PresetPicker tokens={sb.tokens} onChange={(tokens) => update({ tokens })} />

        <details className="details">
          <summary>Fine-tune permissions</summary>
          <fieldset className="fieldset">
            <legend className="sr-only">Sandbox permissions</legend>
            {TOKENS.map((t) => {
              const forcedOff = eff.dropped.some((d) => d.token === t.token);
              return (
                <label key={t.token} className="check">
                  <input type="checkbox" checked={sb.tokens.includes(t.token)} onChange={(e) => toggleToken(t.token, e.target.checked)} />
                  <span>
                    <span className={forcedOff ? 'strike' : undefined}>{t.label}</span>
                    {t.risky && <span className="pill warn">weakens isolation</span>}
                    {t.help && <span className="block muted tiny">{t.help}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </details>

        {eff.dropped.map((d) => (
          <p key={d.token} className="note warn small">
            <IconAlert size={15} /> <span>{d.reason}</span>
          </p>
        ))}

        {sb.kind === 'web' && (
          <label className="check">
            <input type="checkbox" checked={sb.credentialless && clSupported} disabled={!clSupported} onChange={(e) => update({ credentialless: e.target.checked })} />
            <span>
              Fresh session
              <span className="block muted tiny">
                {clSupported
                  ? 'No cookies from your browser are sent, and the page gets temporary storage that is wiped when you close or reload this app. Shared by all fresh-session sandboxes on this page.'
                  : 'Not supported in this browser (needs Chrome or Edge 110+). The page may see cookies you already have for that site.'}
              </span>
            </span>
          </label>
        )}

        <details className="details">
          <summary>Device access ({sb.features.length} allowed)</summary>
          <fieldset className="fieldset">
            <legend className="sr-only">Device and browser features</legend>
            <p className="muted tiny">Anything unticked is blocked inside the frame. The browser still asks you before using the camera, mic or location.</p>
            {FEATURES.map((f) => (
              <label key={f.feature} className="check">
                <input type="checkbox" checked={sb.features.includes(f.feature)} onChange={(e) => toggleFeature(f.feature, e.target.checked)} />
                <span>{f.label}</span>
              </label>
            ))}
          </fieldset>
        </details>

        {sb.kind === 'web' && (
          <label className="field">
            <span>Referrer sent to the site</span>
            <select className="input" value={sb.referrer} onChange={(e) => update({ referrer: e.target.value as Sandbox['referrer'] })}>
              {REFERRERS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="stack-sm">
          <span className="field-label">Frame attributes</span>
          <pre className="attr-preview mono">
            {`sandbox="${eff.tokens.join(' ')}"`}
            {allow && `\nallow="${allow}"`}
            {sb.kind === 'web' && `\nreferrerpolicy="${sb.referrer}"`}
            {sb.kind === 'web' && sb.credentialless && clSupported && '\ncredentialless'}
          </pre>
          <p className="muted tiny">Changing a setting reloads the frame.</p>
        </div>

        <div className="row">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              const copy = duplicateSandbox(sb);
              dispatch({ type: 'create', sandbox: copy });
              navigate(`/s/${copy.id}`);
            }}
          >
            <IconCopy size={15} /> Duplicate
          </button>
          <button type="button" className="btn small danger" onClick={() => remove(sb.id)}>
            <IconTrash size={15} /> Close sandbox
          </button>
        </div>
      </div>
    </aside>
  );
}
