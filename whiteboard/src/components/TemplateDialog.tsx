import { TEMPLATES, type Template } from '../lib/templates';
import { Modal } from './Modal';

export function TemplateDialog({ onPick, onBlank, onClose }: { onPick: (t: Template) => void; onBlank: () => void; onClose: () => void }) {
  return (
    <Modal title="New from template" onClose={onClose} wide>
      <ul className="template-grid">
        <li>
          <button type="button" className="template" onClick={onBlank} data-autofocus>
            <span className="template-emoji" aria-hidden="true">
              ⬜
            </span>
            <span className="template-name">Blank board</span>
            <span className="muted small">An empty canvas.</span>
          </button>
        </li>
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button type="button" className="template" onClick={() => onPick(t)}>
              <span className="template-emoji" aria-hidden="true">
                {t.emoji}
              </span>
              <span className="template-name">{t.name}</span>
              <span className="muted small">{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">Templates are ordinary drawings: change anything. For diagrams from text, open a board and use “Mermaid to diagram” in the menu.</p>
    </Modal>
  );
}
