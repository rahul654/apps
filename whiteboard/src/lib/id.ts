const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Random id, 16 base-36 characters (~82 bits). */
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 36];
  return prefix + s;
}
