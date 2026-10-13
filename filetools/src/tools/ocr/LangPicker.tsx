import { useEffect, useMemo, useState } from 'react';
import { Segmented } from '../../components/common';
import { errorMessage } from '../../components/Feedback';
import { formatBytes } from '../../lib/format';
import { clearCached, listCached, type CachedLang } from '../../lib/ocr/cache';
import { BUNDLED_FAST, OCR_LANGUAGES, languageByCode, type OcrModel } from '../../lib/ocr/langs';

interface Props {
  codes: string[];
  model: OcrModel;
  onChange: (codes: string[], model: OcrModel) => void;
  disabled?: boolean;
  /** Bump to refresh the cached list (e.g. after a run downloaded data). */
  refreshKey?: number;
}

/** Multi-select of OCR languages with download sizes, cache status and model choice. */
export function LangPicker({ codes, model, onChange, disabled, refreshKey }: Props) {
  const [cached, setCached] = useState<CachedLang[]>([]);
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = () =>
    listCached()
      .then(setCached)
      .catch((e) => setErr(`Cache unavailable: ${errorMessage(e)}`));
  useEffect(() => {
    void refresh();
  }, [refreshKey]);

  const isCached = (code: string, m: OcrModel) => cached.some((c) => c.code === code && c.model === m);
  const isBundled = (code: string, m: OcrModel) => m === 'fast' && (BUNDLED_FAST as readonly string[]).includes(code);
  const toggle = (code: string) => {
    const next = codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code];
    if (next.length) onChange(next, model);
  };
  const list = useMemo(
    () => OCR_LANGUAGES.filter((l) => !filter.trim() || `${l.name} ${l.script} ${l.code}`.toLowerCase().includes(filter.trim().toLowerCase())),
    [filter],
  );
  const needsDownload = codes.filter((c) => !isBundled(c, model) && !isCached(c, model));
  const downloadBytes = needsDownload.reduce((s, c) => s + (model === 'fast' ? languageByCode(c)!.fastBytes : languageByCode(c)!.bestBytes), 0);

  return (
    <div className="stack-sm lang-picker">
      <div className="field">
        <span>Languages in the image</span>
        <div className="row">
          {codes.map((c) => (
            <span key={c} className="chip">
              {languageByCode(c)?.name ?? c}
              {codes.length > 1 && (
                <button type="button" className="chip-x" aria-label={`Remove ${languageByCode(c)?.name}`} disabled={disabled} onClick={() => toggle(c)}>
                  ✕
                </button>
              )}
            </span>
          ))}
          <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={disabled}>
            {open ? 'Done' : '+ Languages'}
          </button>
        </div>
      </div>
      {open && (
        <div className="card lang-list-card">
          <input className="input" placeholder="Filter languages…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter languages" />
          <ul className="lang-list" aria-label="OCR languages">
            {list.map((l) => {
              const bundled = isBundled(l.code, model);
              const inCache = isCached(l.code, model);
              const size = model === 'fast' ? l.fastBytes : l.bestBytes;
              return (
                <li key={l.code}>
                  <label className="check">
                    <input type="checkbox" checked={codes.includes(l.code)} disabled={disabled} onChange={() => toggle(l.code)} />
                    <span className="grow">
                      {l.name} <span className="tiny muted">{l.script}</span>
                    </span>
                    <span className={`tag${bundled ? '' : inCache ? ' ok' : ' muted'}`}>{bundled ? 'built in' : inCache ? 'cached' : `↓ ${formatBytes(size)}`}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="field">
        <span>Accuracy</span>
        <Segmented
          label="Model"
          value={model}
          onChange={(m) => onChange(codes, m)}
          options={[
            { value: 'fast', label: 'Fast', disabled },
            { value: 'best', label: 'Best (slower)', disabled },
          ]}
        />
      </div>
      {needsDownload.length > 0 && (
        <p className="tiny warn-text">
          Will download {needsDownload.map((c) => languageByCode(c)?.name).join(', ')} ({formatBytes(downloadBytes)}) language data from jsDelivr — your images are never uploaded.
        </p>
      )}
      <details className="tiny muted">
        <summary>Cached language data ({cached.length ? formatBytes(cached.reduce((s, c) => s + c.bytes, 0)) : 'none'})</summary>
        {cached.length ? (
          <ul>
            {cached.map((c) => (
              <li key={c.key}>
                {languageByCode(c.code)?.name ?? c.code} · {c.model} · {formatBytes(c.bytes)}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing cached yet.</p>
        )}
        <button
          type="button"
          className="btn small"
          disabled={!cached.length || disabled}
          onClick={async () => {
            try {
              await clearCached();
            } catch (e) {
              setErr(errorMessage(e));
            }
            await refresh();
          }}
        >
          Clear cache
        </button>
        {err && <p className="danger-text">{err}</p>}
      </details>
    </div>
  );
}
