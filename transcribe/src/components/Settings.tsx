import { useEffect, useId, useState } from 'react';
import { SORTED_LANGUAGES } from '../lib/languages';
import { MODELS, MODEL_LICENCE } from '../lib/models';
import type { Prefs } from '../lib/prefs';
import { formatBytes } from '../lib/time';
import { webGpuAvailable } from '../media/features';
import { listCachedModels, type CachedModel } from '../media/modelCache';
import type { Backend } from '../types';
import { IconCheck } from './Icons';

/** Backend the worker will pick for a choice (it re-checks for itself). */
export function useResolvedBackend(choice: Prefs['backend']): { backend: Backend; gpu: boolean | null } {
  const [gpu, setGpu] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void webGpuAvailable().then((g) => live && setGpu(g));
    return () => {
      live = false;
    };
  }, []);
  const backend: Backend = choice === 'wasm' ? 'wasm' : choice === 'webgpu' ? (gpu === false ? 'wasm' : 'webgpu') : gpu ? 'webgpu' : 'wasm';
  return { backend, gpu };
}

export function useCachedModels(refreshKey?: unknown): CachedModel[] | null {
  const [list, setList] = useState<CachedModel[] | null>(null);
  useEffect(() => {
    let live = true;
    void listCachedModels().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [refreshKey]);
  return list;
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  const name = useId();
  return (
    <fieldset className="field" disabled={disabled}>
      <legend className="label">{label}</legend>
      <div className="segmented">
        {options.map(([v, text]) => (
          <label key={v} className={v === value ? 'seg-opt on' : 'seg-opt'}>
            <input type="radio" name={name} value={v} checked={v === value} onChange={() => onChange(v)} />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsPanel({ prefs, onChange, disabled, cacheKey }: { prefs: Prefs; onChange: (p: Partial<Prefs>) => void; disabled?: boolean; cacheKey?: unknown }) {
  const { backend, gpu } = useResolvedBackend(prefs.backend);
  const cached = useCachedModels(cacheKey);
  const langId = useId();
  const modelName = useId();
  return (
    <div className="settings">
      <fieldset className="field" disabled={disabled}>
        <legend className="label">Model</legend>
        <div className="model-grid">
          {MODELS.map((m) => {
            const c = cached?.find((x) => x.modelId === m.id);
            const ready = c?.ready.includes(backend);
            return (
              <label key={m.id} className={m.id === prefs.model ? 'model-card on' : 'model-card'}>
                <input type="radio" name={modelName} value={m.id} checked={m.id === prefs.model} onChange={() => onChange({ model: m.id })} />
                <span className="model-head">
                  <strong>{m.label}</strong>
                  <span className="muted tiny">{m.params} params</span>
                </span>
                <span className="small">{ready ? <span className="ok-text row-inline"><IconCheck size={14} /> Downloaded</span> : <>{formatBytes(m.mb[backend] * 1e6)} download</>}</span>
                <span className="muted tiny">{m.note}</span>
              </label>
            );
          })}
        </div>
        <p className="muted tiny">Whisper by OpenAI · {MODEL_LICENCE}. Sizes are for {backend === 'webgpu' ? 'WebGPU' : 'WASM'}.</p>
      </fieldset>

      <div className="settings-row">
        <div className="field">
          <label className="label" htmlFor={langId}>
            Spoken language
          </label>
          <select id={langId} className="input" value={prefs.language} onChange={(e) => onChange({ language: e.target.value })} disabled={disabled}>
            <option value="">Detect automatically</option>
            {SORTED_LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <Segmented label="Task" value={prefs.task} options={[['transcribe', 'Transcribe'], ['translate', 'Translate to English']]} onChange={(task) => onChange({ task })} disabled={disabled} />
        <Segmented label="Timestamps" value={prefs.timestamps} options={[['segment', 'Segments'], ['word', 'Words']]} onChange={(timestamps) => onChange({ timestamps })} disabled={disabled} />
        <Segmented
          label="Run on"
          value={prefs.backend}
          options={[['auto', 'Auto'], ['webgpu', 'WebGPU'], ['wasm', 'CPU (WASM)']]}
          onChange={(b) => onChange({ backend: b })}
          disabled={disabled}
        />
      </div>
      <p className="muted tiny" aria-live="polite">
        {gpu === null ? 'Checking for WebGPU…' : gpu ? 'WebGPU is available: the GPU will be used.' : 'WebGPU isn’t available here: running on the CPU with WebAssembly (single-threaded).'}
        {prefs.backend === 'webgpu' && gpu === false ? ' WebGPU was chosen but isn’t available, so WASM will be used.' : ''}
      </p>
      <label className="check">
        <input type="checkbox" checked={prefs.keepAudio} onChange={(e) => onChange({ keepAudio: e.target.checked })} disabled={disabled} />
        <span>Keep the audio with the transcript (for playback), in this browser only</span>
      </label>
    </div>
  );
}
