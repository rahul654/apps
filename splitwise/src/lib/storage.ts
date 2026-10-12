import { ME, type AppData } from '../types';

export const STORAGE_KEY = 'splitwise:data:v1';

export function emptyData(): AppData {
  return {
    version: 1,
    people: [{ id: ME, name: 'You', email: '', createdAt: new Date().toISOString() }],
    groups: [],
    expenses: [],
    activity: [],
    settings: { currency: 'INR' },
  };
}

/** Light structural check so a corrupt or foreign JSON blob can't crash the app. */
export function parseData(text: string): AppData | null {
  try {
    const d = JSON.parse(text) as Partial<AppData>;
    if (!d || d.version !== 1) return null;
    if (![d.people, d.groups, d.expenses, d.activity].every(Array.isArray)) return null;
    if (!d.settings || typeof d.settings.currency !== 'string') return null;
    const data = d as AppData;
    if (!data.people.some((p) => p.id === ME)) data.people.unshift(emptyData().people[0]);
    return data;
  } catch {
    return null;
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (raw && parseData(raw)) || emptyData();
  } catch {
    return emptyData();
  }
}

export function saveData(data: AppData): void {
  try {
    const json = JSON.stringify(data);
    // Skipping identical writes stops two open tabs echoing `storage` events at each other.
    if (localStorage.getItem(STORAGE_KEY) !== json) localStorage.setItem(STORAGE_KEY, json);
  } catch (err) {
    console.warn('Could not save to localStorage', err);
  }
}
