import type { Person } from '../types';

const COLORS = ['#1cc29f', '#5c6bc0', '#ff8a65', '#ab47bc', '#26a69a', '#ec407a', '#42a5f5', '#8d6e63', '#ffa726', '#7e57c2'];

export function Avatar({ person, size = 32 }: { person?: Person; size?: number }) {
  const name = person?.name ?? '?';
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?';
  let hash = 0;
  for (const c of person?.id ?? name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4, background: COLORS[hash % COLORS.length] }}
    >
      {initials}
    </span>
  );
}
