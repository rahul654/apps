// Regex evaluation used by the regex worker (kept pure so it can be unit-tested).

export const REGEX_FLAGS = ['g', 'i', 'm', 's', 'u', 'v', 'y'] as const;

export interface RegexMatch {
  index: number;
  end: number;
  text: string;
  groups: (string | undefined)[];
  named: Record<string, string | undefined> | null;
}

export interface RegexRequest {
  pattern: string;
  flags: string;
  text: string;
  replacement?: string;
  maxMatches?: number;
}

export type RegexResponse =
  | { ok: true; matches: RegexMatch[]; truncated: boolean; replaced?: string; groupNames: string[]; groupCount: number }
  | { ok: false; error: string };

export function buildRegex(pattern: string, flags: string): RegExp {
  return new RegExp(pattern, flags);
}

/** Count capture groups by matching the empty string against `(?:pattern)|`. */
function groupCount(re: RegExp): number {
  try {
    const probe = new RegExp(`${re.source}|`, re.flags.replace(/[gy]/g, ''));
    return (probe.exec('')?.length ?? 1) - 1;
  } catch {
    return 0;
  }
}

function namesOf(source: string): string[] {
  const names: string[] = [];
  const re = /\(\?<([A-Za-z_$][\w$]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) names.push(m[1]);
  return names;
}

export function runRegex(req: RegexRequest): RegexResponse {
  let re: RegExp;
  try {
    re = buildRegex(req.pattern, req.flags);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const max = req.maxMatches ?? 5000;
  const matches: RegexMatch[] = [];
  let truncated = false;
  const toMatch = (m: RegExpExecArray): RegexMatch => ({
    index: m.index,
    end: m.index + m[0].length,
    text: m[0],
    groups: m.slice(1),
    named: m.groups ? { ...m.groups } : null,
  });
  if (re.global) {
    for (const m of req.text.matchAll(re)) {
      if (matches.length >= max) {
        truncated = true;
        break;
      }
      matches.push(toMatch(m as RegExpExecArray));
    }
  } else {
    const m = re.exec(req.text);
    if (m) matches.push(toMatch(m));
  }
  let replaced: string | undefined;
  if (req.replacement !== undefined) {
    re.lastIndex = 0;
    replaced = req.text.replace(re, req.replacement);
  }
  return { ok: true, matches, truncated, replaced, groupNames: namesOf(req.pattern), groupCount: groupCount(re) };
}

export interface HighlightSeg {
  text: string;
  match: number | null; // index in matches
}

/** Split text into plain / matched segments for highlighting (zero-length matches are skipped). */
export function highlightSegments(text: string, matches: RegexMatch[], maxSegments = 2000): HighlightSeg[] {
  const segs: HighlightSeg[] = [];
  let pos = 0;
  for (let i = 0; i < matches.length && segs.length < maxSegments; i++) {
    const m = matches[i];
    if (m.end === m.index || m.index < pos) continue;
    if (m.index > pos) segs.push({ text: text.slice(pos, m.index), match: null });
    segs.push({ text: text.slice(m.index, m.end), match: i });
    pos = m.end;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), match: null });
  return segs;
}
