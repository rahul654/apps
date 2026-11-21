/** Unicode script detection used to choose how a text box is written to the PDF. */
import { isWinAnsiChar } from '../winAnsi';

/** Scripts that need shaping (conjuncts, joining, reordering) or right-to-left layout, or CJK. */
export const COMPLEX_SCRIPTS: { name: string; re: RegExp }[] = [
  { name: 'Devanagari', re: /\p{Script=Devanagari}/u },
  { name: 'Bengali', re: /\p{Script=Bengali}/u },
  { name: 'Gurmukhi', re: /\p{Script=Gurmukhi}/u },
  { name: 'Gujarati', re: /\p{Script=Gujarati}/u },
  { name: 'Odia', re: /\p{Script=Oriya}/u },
  { name: 'Tamil', re: /\p{Script=Tamil}/u },
  { name: 'Telugu', re: /\p{Script=Telugu}/u },
  { name: 'Kannada', re: /\p{Script=Kannada}/u },
  { name: 'Malayalam', re: /\p{Script=Malayalam}/u },
  { name: 'Sinhala', re: /\p{Script=Sinhala}/u },
  { name: 'Arabic', re: /\p{Script=Arabic}/u },
  { name: 'Hebrew', re: /\p{Script=Hebrew}/u },
  { name: 'Syriac', re: /\p{Script=Syriac}/u },
  { name: 'Thaana', re: /\p{Script=Thaana}/u },
  { name: 'Thai', re: /\p{Script=Thai}/u },
  { name: 'Lao', re: /\p{Script=Lao}/u },
  { name: 'Khmer', re: /\p{Script=Khmer}/u },
  { name: 'Myanmar', re: /\p{Script=Myanmar}/u },
  { name: 'Tibetan', re: /\p{Script=Tibetan}/u },
  { name: 'Mongolian', re: /\p{Script=Mongolian}/u },
  { name: 'Chinese', re: /\p{Script=Han}|\p{Script=Bopomofo}/u },
  { name: 'Japanese', re: /\p{Script=Hiragana}|\p{Script=Katakana}/u },
  { name: 'Korean', re: /\p{Script=Hangul}/u },
];

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|‍|️|⃣/u;
const RTL_CHAR = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
const COMBINING = /\p{M}/u;
/** Scripts written without spaces: line breaks are allowed between words/characters. */
export const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}　-〿＀-￯]/u;

export function isEmojiChar(ch: string): boolean {
  // ©, ®, ™ are "pictographic" but plain WinAnsi text.
  return EMOJI.test(ch) && !isWinAnsiChar(ch);
}

export function isRtlChar(ch: string): boolean {
  return RTL_CHAR.test(ch);
}

export interface ScriptReport {
  /** Complex script names found (need shaping / RTL / CJK). */
  complex: string[];
  emoji: boolean;
  /** Combining marks that remain after NFC normalisation (need mark positioning). */
  combining: boolean;
  rtl: boolean;
  /** Any character outside WinAnsi. */
  nonWinAnsi: boolean;
}

export function analyzeText(text: string): ScriptReport {
  const t = text.normalize('NFC');
  const complex = COMPLEX_SCRIPTS.filter((s) => s.re.test(t)).map((s) => s.name);
  let emoji = false;
  let nonWinAnsi = false;
  for (const ch of t) {
    if (!emoji && isEmojiChar(ch)) emoji = true;
    if (!nonWinAnsi && !isWinAnsiChar(ch)) nonWinAnsi = true;
  }
  return { complex, emoji, combining: COMBINING.test(t), rtl: RTL_CHAR.test(t), nonWinAnsi };
}

/** Base direction from the first strong character (Unicode bidi rule P2), default LTR. */
export function baseDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (RTL_CHAR.test(ch) && /\p{L}/u.test(ch)) return 'rtl';
    if (/\p{L}/u.test(ch)) return 'ltr';
  }
  return 'ltr';
}

/** Strong direction of a word: R, L, or N (neutral: spaces, punctuation; digits count as L). */
export function wordDirection(text: string): 'R' | 'L' | 'N' {
  let l = false;
  for (const ch of text) {
    if (RTL_CHAR.test(ch) && /[\p{L}\p{M}]/u.test(ch)) return 'R';
    if (/[\p{L}\p{Nd}]/u.test(ch)) l = true;
  }
  return l ? 'L' : 'N';
}
