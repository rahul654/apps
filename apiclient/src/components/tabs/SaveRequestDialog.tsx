/** "Save request" for a new tab: pick a name, a collection (or create one) and a folder, as in Postman. */
import { useMemo, useState } from 'react';
import { walkItems } from '../../lib/postman/items';
import { collectionId, isItemGroup } from '../../lib/postman/normalize';
import type { PmCollection } from '../../lib/postman/types';
import { Modal } from '../Modal';

const NEW = '__new__';

export function SaveRequestDialog({ initialName, collections, onSave, onCancel }: { initialName: string; collections: PmCollection[]; onSave: (o: { cid: string | null; newCollectionName?: string; folderId: string | null; name: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  const [cid, setCid] = useState(collections[0] ? collectionId(collections[0]) : NEW);
  const [newName, setNewName] = useState('New collection');
  const [folderId, setFolderId] = useState('');
  const folders = useMemo(() => {
    const c = collections.find((x) => collectionId(x) === cid);
    const out: { id: string; path: string }[] = [];
    if (c)
      walkItems(c.item, ({ item, parents }) => {
        if (isItemGroup(item)) out.push({ id: item.id!, path: [...parents.map((p) => p.name), item.name].join(' / ') });
      });
    return out;
  }, [collections, cid]);
  const valid = name.trim() && (cid !== NEW || newName.trim());
  const submit = () => valid && onSave({ cid: cid === NEW ? null : cid, newCollectionName: cid === NEW ? newName : undefined, folderId: cid === NEW ? null : folderId || null, name });
  return (
    <Modal
      title="Save request"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!valid} onClick={submit}>
            Save
          </button>
        </>
      }
    >
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>Request name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Collection</span>
          <select className="input" value={cid} onChange={(e) => {
            setCid(e.target.value);
            setFolderId('');
          }}>
            {collections.map((c) => (
              <option key={collectionId(c)} value={collectionId(c)}>
                {c.info.name}
              </option>
            ))}
            <option value={NEW}>New collection…</option>
          </select>
        </label>
        {cid === NEW ? (
          <label className="field">
            <span>New collection name</span>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
        ) : (
          folders.length > 0 && (
            <label className="field">
              <span>Folder</span>
              <select className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">Collection root</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.path}
                  </option>
                ))}
              </select>
            </label>
          )
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
