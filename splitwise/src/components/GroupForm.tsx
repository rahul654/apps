import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GROUP_TYPES } from '../lib/categories';
import { involves } from '../lib/balances';
import { newId } from '../lib/id';
import { useApp } from '../store/AppStore';
import { ME, type Group, type GroupType, type ID, type Person } from '../types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

export function GroupForm({ onClose, group }: { onClose: () => void; group?: Group }) {
  const { data, dispatch, nameOf } = useApp();
  const navigate = useNavigate();
  const friends = data.people.filter((p) => p.id !== ME);

  const [name, setName] = useState(group?.name ?? '');
  const [type, setType] = useState<GroupType>(group?.type ?? 'trip');
  const [members, setMembers] = useState<Set<ID>>(() => new Set(group?.memberIds ?? [ME]));
  const [simplify, setSimplify] = useState(group?.simplifyDebts ?? true);
  const [newPeople, setNewPeople] = useState<Person[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  // Members with expenses in this group can't be removed without corrupting its balances.
  const locked = useMemo(() => {
    const ids = new Set<ID>([ME]);
    if (group) {
      for (const e of data.expenses) {
        if (e.groupId !== group.id) continue;
        for (const id of group.memberIds) if (involves(e, id)) ids.add(id);
      }
    }
    return ids;
  }, [data.expenses, group]);

  const toggle = (id: ID) =>
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function addNewPerson() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const taken = [...data.people, ...newPeople].some((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (taken) return setError(`${trimmed} already exists — tick them in the list instead.`);
    setNewPeople((prev) => [...prev, { id: newId(), name: trimmed, email: '', createdAt: new Date().toISOString() }]);
    setNewName('');
    setError('');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the group a name.');
    const memberIds = [ME, ...friends.map((f) => f.id).filter((id) => members.has(id)), ...newPeople.map((p) => p.id)];
    const next: Group = {
      id: group?.id ?? newId(),
      name: name.trim(),
      type,
      memberIds,
      simplifyDebts: simplify,
      createdAt: group?.createdAt ?? new Date().toISOString(),
    };
    dispatch({ type: group ? 'group/update' : 'group/add', group: next, newPeople });
    if (!group) navigate(`/groups/${next.id}`);
    onClose();
  }

  return (
    <Modal title={group ? 'Edit group' : 'Start a new group'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>Group name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Goa trip" />
          </label>

          <div className="field">
            <span>Type</span>
            <div className="segmented">
              {GROUP_TYPES.map((t) => (
                <button key={t.id} type="button" className={t.id === type ? 'active' : ''} onClick={() => setType(t.id)}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Members</span>
            <ul className="check-list">
              <li>
                <label>
                  <input type="checkbox" checked disabled />
                  <Avatar person={data.people.find((p) => p.id === ME)} size={24} /> {nameOf(ME)}
                </label>
              </li>
              {friends.map((f) => (
                <li key={f.id}>
                  <label title={locked.has(f.id) ? 'Has expenses in this group' : undefined}>
                    <input
                      type="checkbox"
                      checked={members.has(f.id)}
                      disabled={locked.has(f.id)}
                      onChange={() => toggle(f.id)}
                    />
                    <Avatar person={f} size={24} /> {f.name}
                    {locked.has(f.id) && <small className="muted"> · has expenses</small>}
                  </label>
                </li>
              ))}
              {newPeople.map((p) => (
                <li key={p.id}>
                  <label>
                    <input type="checkbox" checked readOnly />
                    <Avatar person={p} size={24} /> {p.name} <small className="muted">· new</small>
                  </label>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setNewPeople((prev) => prev.filter((x) => x.id !== p.id))}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="inline-add">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addNewPerson();
                  }
                }}
                placeholder="Add someone new by name"
              />
              <button type="button" className="btn" onClick={addNewPerson}>Add</button>
            </div>
          </div>

          <label className="toggle">
            <input type="checkbox" checked={simplify} onChange={(e) => setSimplify(e.target.checked)} />
            <span>
              <strong>Simplify group debts</strong>
              <small className="muted">Combine debts so the group needs as few repayments as possible.</small>
            </span>
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{group ? 'Save' : 'Create group'}</button>
        </footer>
      </form>
    </Modal>
  );
}
