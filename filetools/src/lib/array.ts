/** Move the item at `from` to index `to` (immutable). Out-of-range indices are clamped. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list.slice();
  const target = Math.max(0, Math.min(list.length - 1, to));
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}

let counter = 0;
/** Short unique id for UI items. */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e9;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
