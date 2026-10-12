import { useState } from 'react';
import { ExpenseForm } from '../components/ExpenseForm';
import { ExpenseList } from '../components/ExpenseList';
import { PageHeader } from '../components/PageHeader';
import { CATEGORIES } from '../lib/categories';
import { useApp } from '../store/AppStore';

export function AllExpensesPage() {
  const { data, nameOf } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [groupId, setGroupId] = useState('');
  const [adding, setAdding] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = data.expenses.filter((e) => {
    if (category === 'payments' ? e.kind !== 'payment' : category && e.category !== category) return false;
    if (groupId === 'none' ? e.groupId !== null : groupId && e.groupId !== groupId) return false;
    if (!q) return true;
    const people = [...e.paidBy, ...e.owedBy].map((s) => nameOf(s.personId).toLowerCase());
    return e.description.toLowerCase().includes(q) || e.notes.toLowerCase().includes(q) || people.some((n) => n.includes(q));
  });

  return (
    <>
      <PageHeader
        title="All expenses"
        actions={<button type="button" className="btn btn-accent" onClick={() => setAdding(true)}>Add an expense</button>}
      />
      <div className="filters">
        <input type="search" placeholder="Search description, notes or people" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          <option value="payments">💸 Payments only</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
          ))}
        </select>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Group">
          <option value="">All groups</option>
          <option value="none">No group</option>
          {data.groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
      <ExpenseList expenses={filtered} />
      {adding && <ExpenseForm onClose={() => setAdding(false)} />}
    </>
  );
}
