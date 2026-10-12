export const CATEGORIES = [
  { id: 'general', label: 'General', icon: '🧾' },
  { id: 'food', label: 'Food & drink', icon: '🍽️' },
  { id: 'groceries', label: 'Groceries', icon: '🛒' },
  { id: 'rent', label: 'Rent', icon: '🏠' },
  { id: 'utilities', label: 'Utilities', icon: '💡' },
  { id: 'transport', label: 'Transport', icon: '🚕' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
  { id: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️' },
  { id: 'health', label: 'Health', icon: '💊' },
  { id: 'other', label: 'Other', icon: '📦' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export function categoryOf(id: string) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

export const GROUP_TYPES = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'trip', label: 'Trip', icon: '✈️' },
  { id: 'couple', label: 'Couple', icon: '❤️' },
  { id: 'other', label: 'Other', icon: '👥' },
] as const;

export function groupTypeOf(id: string) {
  return GROUP_TYPES.find((t) => t.id === id) ?? GROUP_TYPES[3];
}
