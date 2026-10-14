import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DropZone } from '../components/DropZone';
import { Editor } from '../components/Editor';
import { IconLock } from '../components/Icons';
import { ModelPicker } from '../components/ModelPicker';
import { BackgroundPanel, ExportPanel, RefinePanel } from '../components/Panels';
import { QueueList } from '../components/QueueList';
import { ACCEPT, isImageFile, useApp } from '../store/AppStore';

function PrivacyNote() {
  return (
    <p className="privacy tiny muted">
      <IconLock size={14} />
      <span>
        Runs on your device; images are never uploaded. The first run downloads the model. Hair, glass and see-through things are hard for any model. <Link to="/about">More</Link>
      </span>
    </p>
  );
}

function Rejected({ names, onDismiss }: { names: string[]; onDismiss: () => void }) {
  if (!names.length) return null;
  return (
    <div className="note warn small" role="alert">
      <span className="grow">
        Skipped {names.length} file{names.length > 1 ? 's' : ''} that {names.length > 1 ? 'aren’t images' : 'isn’t an image'}: {names.slice(0, 4).join(', ')}
        {names.length > 4 ? '…' : ''}
      </span>
      <button type="button" className="btn ghost small" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function WorkspacePage() {
  const { queue, addFiles } = useApp();
  const selected = queue.items.find((i) => i.id === queue.selectedId) ?? null;
  const [rejected, setRejected] = useState<string[]>([]);
  const rejectedNote = <Rejected names={rejected} onDismiss={() => setRejected([])} />;
  const hasItems = queue.items.length > 0;
  // The layout changes completely once there are images; start at the top so the editor is in view.
  useEffect(() => {
    const main = document.getElementById('main');
    if (hasItems && main) main.scrollTop = 0;
  }, [hasItems]);

  if (!queue.items.length) {
    return (
      <div className="page">
        <div className="home">
          <div className="hero card">
            <h1>Remove image backgrounds in your browser</h1>
            <p className="muted">Drop photos, get cut-outs with transparent, coloured, blurred or custom backgrounds. Fix edges with an erase/restore brush and download PNG, WebP or JPEG at full size.</p>
            <DropZone accept={ACCEPT} filter={isImageFile} onFiles={addFiles} label="Drop images here or click to choose" hint="PNG, JPEG or WebP; several at once is fine" paste onReject={setRejected} />
            {rejectedNote}
            <PrivacyNote />
          </div>
          <ModelPicker />
        </div>
      </div>
    );
  }

  return (
    <div className="page fill">
      <div className="workspace">
        <aside className="col-left" aria-label="Images and model">
          <DropZone accept={ACCEPT} filter={isImageFile} onFiles={addFiles} label="Add images" hint="Drop, choose" paste compact onReject={setRejected} />
          {rejectedNote}
          <QueueList />
          <ModelPicker compact />
          <PrivacyNote />
        </aside>
        <div className="col-main">{selected ? <Editor key={selected.id} item={selected} /> : <div className="card empty">Select an image.</div>}</div>
        <aside className="col-right" aria-label="Adjustments and export">
          {selected && <RefinePanel item={selected} />}
          <BackgroundPanel />
          <ExportPanel item={selected} />
        </aside>
      </div>
    </div>
  );
}
