/**
 * pdf-lib's 14 standard fonts can only encode WinAnsi (Windows-1252) characters.
 * Anything else (Hindi, Arabic, CJK, emoji…) would throw when saving, so we check first.
 */

// Unicode code points that Windows-1252 maps into 0x80–0x9F.
const CP1252_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function isWinAnsiChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (cp === 0x0a || cp === 0x0d || cp === 0x09) return true; // handled as line breaks / spaces
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return CP1252_EXTRA.has(cp);
}

/** Distinct characters in `text` that standard PDF fonts can't encode, in first-seen order. */
export function unsupportedChars(text: string): string[] {
  const seen = new Set<string>();
  for (const ch of text) if (!isWinAnsiChar(ch)) seen.add(ch);
  return [...seen];
}

/** Replace unsupported characters with "?" (used only if the user explicitly opts in). */
export function replaceUnsupported(text: string, replacement = '?'): string {
  let out = '';
  for (const ch of text) out += isWinAnsiChar(ch) ? ch : replacement;
  return out;
}
