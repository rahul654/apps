import { useEffect, useState } from 'react';
import { ErrorCallout } from '../components/Callout';
import { IconDownload, IconTrash } from '../components/Icons';
import { ProgressBar } from '../components/Progress';
import { useCachedModels, useResolvedBackend } from '../components/Settings';
import type { ErrorInfo } from '../lib/errors';
import { MODELS, MODEL_LICENCE } from '../lib/models';
import { formatBytes } from '../lib/time';
import { deleteCachedModel } from '../media/modelCache';
import { CancelledError, ortBase, whisper } from '../media/whisperClient';
import { usePrefs } from '../store/prefs';
import { useJob } from '../store/job';

export function AboutPage() {
  const [prefs] = usePrefs();
  const { backend, gpu } = useResolvedBackend(prefs.backend);
  const [refresh, setRefresh] = useState(0);
  const cached = useCachedModels(refresh);
  const job = useJob();
  const [busy, setBusy] = useState<{ id: string; loaded: number; total: number } | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  useEffect(() => {
    document.title = 'About · Speech to Text';
  }, []);

  const fetchModel = async (id: string) => {
    setError(null);
    setBusy({ id, loaded: 0, total: 0 });
    try {
      await whisper.load({ model: id, backend: prefs.backend, ortBase: ortBase() }, (m) => {
        if (m.type === 'download') {
          setBusy({ id, loaded: m.files.reduce((s, f) => s + Math.min(f.loaded, f.total), 0), total: m.files.reduce((s, f) => s + f.total, 0) });
        }
      });
    } catch (e) {
      if (!(e instanceof CancelledError)) setError({ title: 'Download failed', message: (e as Error).message, canRetry: false });
    } finally {
      setBusy(null);
      setRefresh((r) => r + 1);
    }
  };

  const remove = async (id: string) => {
    await deleteCachedModel(id);
    setRefresh((r) => r + 1);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>About</h1>
      </header>

      <section className="card stack-sm prose" aria-labelledby="privacy-h">
        <h2 id="privacy-h">Privacy and limits</h2>
        <ul>
          <li>
            <strong>On-device.</strong> Whisper runs in your browser. Audio, recordings and transcripts aren’t uploaded anywhere; the library lives in this browser’s storage.
          </li>
          <li>
            <strong>First run downloads the model</strong> from Hugging Face (44 MB to 590 MB depending on model and backend). It’s kept in this browser, so later runs work without a connection.
          </li>
          <li>
            <strong>Speed depends on your device.</strong> With WebGPU a minute of audio can take seconds; on the CPU (single-threaded WebAssembly, because this site can’t enable
            multi-threading on GitHub Pages) Tiny runs at a few times real time on a laptop, and Small can be slower than real time.
          </li>
          <li>
            <strong>Tiny and Base are less accurate</strong>, especially with accents, noise, names and languages other than English. Use Small for important work, and check the result.
          </li>
          <li>
            <strong>Live dictation is different.</strong> It uses the browser’s Web Speech API: Chrome and Edge send the audio to their speech servers. Firefox doesn’t support it.
          </li>
          <li>Whisper sometimes gets stuck repeating a phrase, or invents text on silence or music. Silent 30-second stretches are skipped; a stretch that comes out as a loop is decoded again, and any repeats left are collapsed.</li>
          <li>Very long files need a lot of memory to decode (about 40 MB per 10 minutes once decoded to 16 kHz, plus the browser’s own working copy).</li>
        </ul>
      </section>

      <section className="card stack-sm" aria-labelledby="models-h">
        <h2 id="models-h">Models</h2>
        <p className="muted small">
          {gpu === null ? 'Checking for WebGPU…' : gpu ? 'WebGPU is available in this browser.' : 'WebGPU isn’t available here, so models run on the CPU with WebAssembly.'} Sizes below are for{' '}
          {backend === 'webgpu' ? 'WebGPU' : 'WASM'}. {MODEL_LICENCE}.
        </p>
        {error && <ErrorCallout error={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Download</th>
                <th scope="col">On this device</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => {
                const c = cached?.find((x) => x.modelId === m.id);
                const loading = busy?.id === m.id;
                return (
                  <tr key={m.id}>
                    <th scope="row">
                      {m.label} <span className="muted tiny">({m.params})</span>
                      <div className="muted tiny mono">{m.id}</div>
                    </th>
                    <td>{formatBytes(m.mb[backend] * 1e6)}</td>
                    <td>
                      {loading ? (
                        <div className="stack-xs" aria-live="polite">
                          <ProgressBar value={busy.total ? busy.loaded / busy.total : null} label={`Downloading ${m.label}`} />
                          <span className="tiny muted">{busy.total ? `${formatBytes(busy.loaded)} of ${formatBytes(busy.total)}` : 'Starting…'}</span>
                        </div>
                      ) : c ? (
                        <span className="small">
                          {formatBytes(c.bytes)}
                          {c.ready.length ? <span className="ok-text"> · ready offline ({c.ready.map((b) => (b === 'webgpu' ? 'WebGPU' : 'WASM')).join(', ')})</span> : ' · incomplete'}
                        </span>
                      ) : (
                        <span className="muted small">Not downloaded</span>
                      )}
                    </td>
                    <td className="actions">
                      {c ? (
                        <button type="button" className="btn small ghost" onClick={() => void remove(m.id)} disabled={!!busy || job.status === 'running'} aria-label={`Delete ${m.label} model files`}>
                          <IconTrash size={15} /> Delete
                        </button>
                      ) : (
                        <button type="button" className="btn small" onClick={() => void fetchModel(m.id)} disabled={!!busy || job.status === 'running'} aria-label={`Download ${m.label} model`}>
                          <IconDownload size={15} /> Download
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack-sm prose" aria-labelledby="tech-h">
        <h2 id="tech-h">How it works</h2>
        <p className="small">
          Whisper (OpenAI) converted to ONNX, run by transformers.js and ONNX Runtime Web {__ORT_VERSION__} in a Web Worker. The runtime’s WebAssembly is served from this site; only model files come from Hugging Face. Audio is decoded by the browser, mixed to mono and
          resampled to 16 kHz. Long recordings are cut into 30-second windows that overlap by 10 seconds; each word or segment is kept by the window that heard it in the middle, and repeated words at the joins are removed.
        </p>
      </section>
    </div>
  );
}
