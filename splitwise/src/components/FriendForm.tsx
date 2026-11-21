import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { newId } from '../lib/id';
import { useApp } from '../store/AppStore';
import type { Person } from '../types';
import { Modal } from './Modal';

export function FriendForm({ onClose, friend }: { onClose: () => void; friend?: Person }) {
  const { data, dispatch } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState(friend?.name ?? '');
  const [email, setEmail] = useState(friend?.email ?? '');
  const [error, setError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name.');
    const clash = data.people.some((p) => p.id !== friend?.id && p.name.toLowerCase() === trimmed.toLowerCase());
    if (clash) return setError(`You already have someone called ${trimmed}.`);

    if (friend) {
      dispatch({ type: 'person/update', id: friend.id, name: trimmed, email: email.trim() });
    } else {
      const person: Person = { id: newId(), name: trimmed, email: email.trim(), createdAt: new Date().toISOString() };
      dispatch({ type: 'person/add', person });
      navigate(`/friends/${person.id}`);
    }
    onClose();
  }

  return (
    <Modal title={friend ? 'Edit friend' : 'Add a friend'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" />
          </label>
          <label className="field">
            <span>Email (optional)</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@example.com" />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{friend ? 'Save' : 'Add friend'}</button>
        </footer>
      </form>
    </Modal>
  );
}
