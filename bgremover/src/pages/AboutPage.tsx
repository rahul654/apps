import { useEffect, useState } from 'react';
import { IconInfo, IconLock, IconTrash } from '../components/Icons';
import { formatBytes } from '../lib/format';
import { deleteCachedModels } from '../lib/modelCache';
import { MODELS, modelLicenceUrl } from '../lib/models';
import { useApp } from '../store/AppStore';

export function AboutPage() {
  const { cached, refreshCache, caps } = useApp();
  const [usage, setUsage] = useState<number | null>(null);
  const [cleared, setCleared] = useState(false);
  const anyCached = Object.values(cached).some(Boolean);

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(e.usage ?? null))
      .catch(() => {});
  }, [cached]);

  return (
    <div className="page">
      <div className="prose">
        <section className="card stack-sm">
          <h1 className="row tight">
            <IconLock size={22} /> Privacy and limits
          </h1>
          <ul className="bullets">
            <li>
              <strong>Everything runs on your device.</strong> Images are decoded, segmented and exported in this browser tab. Nothing is uploaded and there is no server.
            </li>
            <li>
              <strong>The first run downloads a model</strong> from Hugging Face (between {formatBytes(Math.min(...MODELS.map((m) => m.files.fp32.bytes)))} and {formatBytes(Math.max(...MODELS.map((m) => m.files.fp32.bytes)))}, shown before it starts). It is kept in this browser’s storage, so later visits work offline.
            </li>
            <li>
              <strong>Your images aren’t stored.</strong> They stay in memory until you remove them or close the tab. Only settings (model, background, export format) are remembered.
            </li>
            <li>
              <strong>Quality has limits.</strong> Fine hair, fur, glass, smoke and see-through fabric are hard for any model; expect to touch up with the brush. Low-contrast subjects (dark on dark) can lose edges.
            </li>
            <li>
              <strong>Speed depends on your device.</strong> With WebGPU the models use your graphics card; otherwise they run on one CPU thread (this site can’t enable multi-threading). Very large photos use a lot of memory.
            </li>
          </ul>
        </section>

        <section className="card stack-sm">
          <h2>Models</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Model</th>
                  <th scope="col">Download</th>
                  <th scope="col">Licence</th>
                </tr>
              </thead>
              <tbody>
                {MODELS.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">{m.name}</th>
                    <td>
                      <a href={modelLicenceUrl(m)} target="_blank" rel="noreferrer">
                        {m.upstream}
                      </a>
                      <div className="tiny muted">{m.summary}</div>
                    </td>
                    <td className="nowrap">
                      {m.files.fp16 ? `${formatBytes(m.files.fp16.bytes)} (fp16) or ${formatBytes(m.files.fp32.bytes)}` : formatBytes(m.files.fp32.bytes)}
                      {cached[m.id] && <div className="tiny ok-text">Downloaded</div>}
                    </td>
                    <td>{m.licence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted">
            Weights are pinned to a fixed revision and checked against their SHA-256 before use. Best quality uses the half-precision file on GPUs that support it. Inference uses ONNX Runtime Web (MIT), served from this site.
            {caps ? ` WebGPU here: ${caps.webgpu === 'none' ? 'not available' : caps.webgpu === 'software' ? 'software fallback only' : 'yes'}.` : ''}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn danger"
              disabled={!anyCached}
              onClick={async () => {
                await deleteCachedModels();
                setCleared(true);
                refreshCache();
              }}
            >
              <IconTrash size={16} /> Delete downloaded models
            </button>
            {usage !== null && <span className="small muted">This site uses {formatBytes(usage)} of browser storage.</span>}
            {cleared && !anyCached && (
              <span className="small" role="status">
                Deleted.
              </span>
            )}
          </div>
        </section>

        <section className="card stack-sm">
          <h2 className="row tight">
            <IconInfo size={18} /> Keyboard shortcuts
          </h2>
          <dl className="shortcuts">
            <dt>
              <kbd>C</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>H</kbd>
            </dt>
            <dd>Compare, Erase, Restore, Pan</dd>
            <dt>
              <kbd>[</kbd> <kbd>]</kbd>
            </dt>
            <dd>Smaller / bigger brush</dd>
            <dt>
              <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>
            </dt>
            <dd>Undo, redo</dd>
            <dt>
              <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd>
            </dt>
            <dd>Zoom in, out, fit</dd>
            <dt>
              <kbd>Space</kbd> + drag
            </dt>
            <dd>Pan while using a brush</dd>
            <dt>
              <kbd>Ctrl/⌘</kbd>+<kbd>V</kbd>
            </dt>
            <dd>Paste an image</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
