import { formatBytes } from '../lib/format';
import { MODELS, planRun, type ModelId } from '../lib/models';
import { useApp } from '../store/AppStore';
import { IconAlert, IconCheck } from './Icons';

const BACKEND_LABEL = { webgpu: 'WebGPU', wasm: 'CPU (WebAssembly)' } as const;

/** Model choice with sizes, download state and the "download and start" consent. */
export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const { prefs, setPrefs, caps, cached, allowed, allowModel, status, queue } = useApp();
  const selected = MODELS.find((m) => m.id === prefs.model)!;
  const plan = caps ? planRun(selected, caps) : null;
  const waiting = queue.items.some((i) => i.status === 'queued' && i.model === prefs.model);
  const needsConsent = Boolean(caps && plan && !cached[prefs.model] && !allowed.has(prefs.model));
  const loadingThis = status.model === prefs.model && (status.phase === 'downloading' || status.phase === 'initialising');

  return (
    <section className="card stack-sm model-picker" aria-labelledby="model-h">
      <h2 id="model-h">Model</h2>
      <fieldset className="fieldset">
        <legend className="sr-only">Choose a model</legend>
        {MODELS.map((m) => {
          const p = caps ? planRun(m, caps) : null;
          const unavailable = Boolean(caps && !p);
          const size = p ? p.file.bytes : m.files.fp16?.bytes ?? m.files.fp32.bytes;
          return (
            <label key={m.id} className={`model-option${prefs.model === m.id ? ' selected' : ''}${unavailable ? ' unavailable' : ''}`}>
              <input type="radio" name="model" value={m.id} checked={prefs.model === m.id} disabled={unavailable} onChange={() => setPrefs({ model: m.id as ModelId })} />
              <span className="grow stack-xs">
                <span className="row tight">
                  <strong>{m.name}</strong>
                  <span className="muted small">{m.bestFor}</span>
                </span>
                {!compact && <span className="small muted">{m.summary}</span>}
                <span className="tiny">
                  {unavailable ? (
                    <span className="badge warn">Needs WebGPU</span>
                  ) : cached[m.id] ? (
                    <span className="badge ok">
                      <IconCheck size={12} /> Downloaded
                    </span>
                  ) : (
                    <span className="badge">{formatBytes(size)} download</span>
                  )}{' '}
                  {m.experimental && <span className="badge warn">Experimental</span>}{' '}
                  <span className="muted">
                    {m.licence}
                    {p && p.backend === 'webgpu' ? ' · WebGPU' : ''}
                    {p && caps?.webgpu === 'software' && p.backend === 'webgpu' ? ' (software, slow)' : ''}
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {needsConsent && (
        <div className="consent stack-sm">
          <p className="small">
            The <strong>{selected.name}</strong> model is downloaded once ({formatBytes(plan!.file.bytes)}) from Hugging Face and then kept in this browser, so it also works offline. Your images never leave this device.
          </p>
          <button type="button" className="btn primary" onClick={() => allowModel(prefs.model)}>
            Download {formatBytes(plan!.file.bytes)}
            {waiting ? ' and start' : ''}
          </button>
        </div>
      )}

      {loadingThis && (
        <div className="stack-xs" aria-live="polite">
          {status.phase === 'downloading' ? (
            <>
              <span className="small">
                Downloading {selected.name} model… {formatBytes(status.loaded)} of {formatBytes(status.total)}
              </span>
              <progress max={status.total || 1} value={status.loaded} aria-label={`Downloading ${selected.name} model`} />
            </>
          ) : (
            <span className="small row tight">
              <span className="spinner" aria-hidden="true" /> Starting the model…
            </span>
          )}
        </div>
      )}

      {status.phase === 'ready' && status.model === prefs.model && (
        <p className="tiny muted">
          Running on {BACKEND_LABEL[status.backend ?? 'wasm']}
          {status.fellBack ? ' (WebGPU failed for this model, so it fell back to the CPU)' : ''}.
        </p>
      )}
      {status.phase === 'error' && status.model === prefs.model && status.error && (
        <p className="note warn small" role="alert">
          <IconAlert size={16} />
          <span>{status.error}</span>
        </p>
      )}
      {caps?.webgpu === 'none' && !compact && <p className="tiny muted">This browser has no WebGPU, so models run on the CPU. Best quality needs WebGPU (recent Chrome, Edge or Safari).</p>}
    </section>
  );
}
