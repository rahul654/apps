import { useEffect, useState } from 'react';
import { formatBytes } from '../lib/format';
import { requestPersistence, storageInfo, type StorageInfo } from '../media/features';

/** Browser storage usage (navigator.storage.estimate) and persistence status. */
export function StorageMeter({ refreshKey }: { refreshKey?: unknown }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  useEffect(() => {
    void storageInfo().then(setInfo);
  }, [refreshKey]);
  if (!info || !info.quota) return null;
  const pct = Math.min(100, (info.usage / info.quota) * 100);
  return (
    <div className="storage">
      <div className="row small">
        <span>
          Storage: <strong>{formatBytes(info.usage)}</strong> used of {formatBytes(info.quota)} available to this site
        </span>
        <span className="spacer" />
        {info.persisted === true ? (
          <span className="ok-text tiny">Persistent: the browser won’t clear it automatically</span>
        ) : info.persisted === false ? (
          <button type="button" className="btn small ghost" onClick={() => void requestPersistence().then(() => storageInfo().then(setInfo))}>
            Keep recordings when space is low
          </button>
        ) : null}
      </div>
      <div className="progress thin" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div style={{ width: `${Math.max(0.5, pct)}%` }} />
      </div>
    </div>
  );
}
