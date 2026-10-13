import { useEffect, useState } from 'react';
import { DownloadButton, ToolHeader } from '../../components/common';
import { errorMessage, Loading, Notice } from '../../components/Feedback';
import { pdfBlob, type OutputFile } from '../../lib/download';
import { baseName } from '../../lib/format';
import { readMetadata, stripMetadata, writeMetadata, type MetadataEdit, type PdfMetadata } from '../../lib/pdf/ops';
import { PdfFileBar, PdfPickerView, usePdfPicker } from './shared';

const FIELDS: { key: keyof MetadataEdit; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'subject', label: 'Subject' },
  { key: 'keywords', label: 'Keywords (comma-separated)' },
  { key: 'creator', label: 'Creator (app that made the original)' },
  { key: 'producer', label: 'Producer (PDF library)' },
];

const fmtDate = (d?: Date) => (d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : '—');

export default function MetadataTool() {
  const picker = usePdfPicker({ requireWritable: true });
  const { pdf } = picker;
  const [meta, setMeta] = useState<PdfMetadata | null>(null);
  const [edit, setEdit] = useState<MetadataEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ file: OutputFile; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMeta(null);
    setEdit(null);
    setOut(null);
    if (!pdf) return;
    readMetadata(pdf.bytes)
      .then((m) => {
        setMeta(m);
        setEdit({ title: m.title, author: m.author, subject: m.subject, keywords: m.keywords, creator: m.creator, producer: m.producer });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [pdf]);

  if (!pdf) {
    return (
      <>
        <ToolHeader emoji="🏷️" title="PDF metadata">See what a PDF says about itself — title, author, the app that made it, dates — then edit or remove it.</ToolHeader>
        <div style={{ maxWidth: 720 }}><PdfPickerView picker={picker} /></div>
      </>
    );
  }

  const run = async (kind: 'save' | 'strip') => {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const bytes = kind === 'save' ? await writeMetadata(pdf.bytes, edit!) : await stripMetadata(pdf.bytes);
      setOut({
        file: { name: `${baseName(pdf.file.name)}${kind === 'strip' ? '_clean' : ''}.pdf`, blob: pdfBlob(bytes) },
        note:
          kind === 'save'
            ? 'Document info updated. The XMP metadata stream (if there was one) was removed so it can’t contradict the new values.'
            : 'Removed: title, author, subject, keywords, creator, producer, creation/modification dates and the XMP metadata stream.',
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ToolHeader emoji="🏷️" title="PDF metadata" />
      <div className="stack" style={{ maxWidth: 760 }}>
        <PdfFileBar pdf={pdf} onClose={picker.reset} />
        {error && <Notice kind="error">{error}</Notice>}
        {!meta || !edit ? (
          !error && <Loading label="Reading metadata…" />
        ) : (
          <div className="card stack">
            <dl className="kv small">
              <dt>Created</dt><dd>{fmtDate(meta.creationDate)}</dd>
              <dt>Modified</dt><dd>{fmtDate(meta.modificationDate)}</dd>
              <dt>Pages</dt><dd>{meta.pageCount}</dd>
              <dt>XMP metadata</dt><dd>{meta.hasXmp ? 'present (may duplicate the fields below)' : 'none'}</dd>
            </dl>
            <div className="grid-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="field">
                  <span>{f.label}</span>
                  <input className="input" value={edit[f.key]} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn primary" disabled={busy} onClick={() => run('save')}>Save changes</button>
              <button type="button" className="btn danger" disabled={busy} onClick={() => run('strip')}>Strip all metadata</button>
            </div>
            <p className="tiny muted">
              Only document-level metadata is changed. Metadata embedded inside images on the pages (e.g. photo EXIF), comments, form data and hidden layers are not touched.
            </p>
            {out && (
              <>
                <Notice kind="success">{out.note}</Notice>
                <DownloadButton files={[out.file]} />
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
