// Standard 5-field cron: parse, describe in English, and compute next run times in a time zone.
//
//   ┌ minute (0-59)
//   │ ┌ hour (0-23)
//   │ │ ┌ day of month (1-31)
//   │ │ │ ┌ month (1-12 or JAN-DEC)
//   │ │ │ │ ┌ day of week (0-7 or SUN-SAT; 0 and 7 are Sunday)
//   * * * * *
//
// Day matching follows Vixie cron: if either day field starts with "*" (or "?"), a day must
// match BOTH fields; otherwise it matches if EITHER field matches (OR semantics).
import { zonedParts, zonedTimeToUtc } from './time';

export type FieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

interface FieldSpec {
  name: FieldName;
  label: string;
  min: number;
  max: number;
  names?: string[]; // names[i] maps to value min + i
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const FIELD_SPECS: FieldSpec[] = [
  { name: 'minute', label: 'Minute', min: 0, max: 59 },
  { name: 'hour', label: 'Hour', min: 0, max: 23 },
  { name: 'dayOfMonth', label: 'Day of month', min: 1, max: 31 },
  { name: 'month', label: 'Month', min: 1, max: 12, names: MONTHS },
  { name: 'dayOfWeek', label: 'Day of week', min: 0, max: 7, names: DAYS },
];

export const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

/** One comma-separated item of a field. `star` items cover the whole range ("*" or "*\/n"). */
export interface CronPart {
  star: boolean;
  start: number;
  end: number;
  step: number;
  /** True for a bare single value like "5" (no range, no step). */
  single: boolean;
}

export interface CronField {
  source: string;
  parts: CronPart[];
  /** Sorted, de-duplicated allowed values (day-of-week 7 is folded into 0). */
  values: number[];
  set: Set<number>;
  /** Field text starts with "*" or "?" (Vixie's DOM_STAR/DOW_STAR). */
  startsWithStar: boolean;
  /** Every value in the range is allowed. */
  full: boolean;
}

export interface CronExpr {
  source: string;
  expanded: string;
  macro?: string;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export class CronError extends Error {
  constructor(
    message: string,
    public field?: FieldName,
  ) {
    super(message);
  }
}

function parseValue(token: string, spec: FieldSpec): number {
  const upper = token.toUpperCase();
  if (spec.names) {
    const idx = spec.names.indexOf(upper);
    if (idx >= 0) return spec.min === 0 ? idx : idx + spec.min;
  }
  if (!/^\d+$/.test(token)) {
    const hint = spec.names ? ` (use ${spec.min}-${spec.max} or ${spec.names[0]}-${spec.names[spec.names.length - 1]})` : '';
    if (/[LW#]/i.test(token)) throw new CronError(`${spec.label}: "${token}" uses L/W/# which are Quartz extensions, not standard cron`, spec.name);
    throw new CronError(`${spec.label}: "${token}" is not a valid value${hint}`, spec.name);
  }
  const v = Number(token);
  if (v < spec.min || v > spec.max) throw new CronError(`${spec.label}: ${v} is out of range (${spec.min}–${spec.max})`, spec.name);
  return v;
}

function parseField(text: string, spec: FieldSpec): CronField {
  const parts: CronPart[] = [];
  const values = new Set<number>();
  const isDay = spec.name === 'dayOfMonth' || spec.name === 'dayOfWeek';
  for (const item of text.split(',')) {
    if (item === '') throw new CronError(`${spec.label}: empty list item in "${text}"`, spec.name);
    const [base, stepText, extra] = item.split('/');
    if (extra !== undefined) throw new CronError(`${spec.label}: "${item}" has more than one "/"`, spec.name);
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) === 0) throw new CronError(`${spec.label}: step "${stepText}" must be a positive number`, spec.name);
      step = Number(stepText);
    }
    let start: number;
    let end: number;
    let star = false;
    if (base === '*' || (base === '?' && isDay)) {
      if (base === '?' && stepText !== undefined) throw new CronError(`${spec.label}: "?" cannot have a step`, spec.name);
      star = true;
      start = spec.min;
      end = spec.name === 'dayOfWeek' ? 6 : spec.max;
    } else if (base.includes('-')) {
      const [a, b, more] = base.split('-');
      if (more !== undefined || a === '' || b === '') throw new CronError(`${spec.label}: "${base}" is not a valid range`, spec.name);
      start = parseValue(a, spec);
      end = parseValue(b, spec);
      if (start > end) throw new CronError(`${spec.label}: range "${base}" starts after it ends`, spec.name);
    } else {
      start = parseValue(base, spec);
      // "5/15" means "from 5 through the max, every 15".
      end = stepText !== undefined ? (spec.name === 'dayOfWeek' ? 6 : spec.max) : start;
    }
    if (step > spec.max - spec.min + 1) throw new CronError(`${spec.label}: step ${step} is larger than the field's range`, spec.name);
    parts.push({ star, start, end, step, single: !star && stepText === undefined && start === end && !base.includes('-') });
    for (let v = start; v <= end; v += step) values.add(spec.name === 'dayOfWeek' && v === 7 ? 0 : v);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rangeSize = spec.name === 'dayOfWeek' ? 7 : spec.max - spec.min + 1;
  return { source: text, parts, values: sorted, set: values, startsWithStar: text.startsWith('*') || text.startsWith('?'), full: sorted.length === rangeSize };
}

export function parseCron(expression: string): CronExpr {
  const source = expression.trim().replace(/\s+/g, ' ');
  if (source === '') throw new CronError('Enter a cron expression');
  let expanded = source;
  let macro: string | undefined;
  if (source.startsWith('@')) {
    const key = source.toLowerCase();
    if (key === '@reboot') throw new CronError('@reboot runs once at startup and has no schedule');
    if (!MACROS[key]) throw new CronError(`Unknown macro "${source}" (supported: ${Object.keys(MACROS).join(', ')})`);
    macro = key;
    expanded = MACROS[key];
  }
  const fields = expanded.split(' ');
  if (fields.length === 6 || fields.length === 7) {
    throw new CronError(`Found ${fields.length} fields. Only the standard 5-field format is supported (no seconds or year field).`);
  }
  if (fields.length !== 5) throw new CronError(`Expected 5 fields (minute hour day-of-month month day-of-week), found ${fields.length}`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((f, i) => parseField(f, FIELD_SPECS[i]));
  return { source, expanded, macro, minute, hour, dayOfMonth, month, dayOfWeek };
}

/** Day matching with Vixie cron's DOM/DOW rule. */
export function dayMatches(c: CronExpr, day: number, weekday: number): boolean {
  const domMatch = c.dayOfMonth.set.has(day);
  const dowMatch = c.dayOfWeek.set.has(weekday);
  if (c.dayOfMonth.startsWithStar || c.dayOfWeek.startsWithStar) return domMatch && dowMatch;
  return domMatch || dowMatch;
}

const nextIn = (values: number[], after: number) => values.find((v) => v > after);

/**
 * Next `count` run times strictly after `fromMs`, evaluated on the wall clock of `tz`.
 * Local times skipped by a DST jump are skipped; a repeated hour (DST end) runs once.
 * Searches at most ~`horizonYears` ahead (some expressions, like Feb 30, never match).
 */
export function nextRuns(c: CronExpr, fromMs: number, count = 10, tz = 'UTC', horizonYears = 8): number[] {
  const out: number[] = [];
  const seen = new Set<string>();
  let t = Math.floor(fromMs / 60000) * 60000 + 60000;
  const limit = fromMs + horizonYears * 366 * 86400000;
  const wall = (y: number, mo: number, d: number, h: number, mi: number) => zonedTimeToUtc(y, mo, d, h, mi, 0, 0, tz);
  let guard = 0;
  while (out.length < count && t <= limit && guard++ < 200000) {
    const p = zonedParts(t, tz);
    let next: number;
    if (!c.month.set.has(p.month)) {
      const m = nextIn(c.month.values, p.month);
      next = m !== undefined ? wall(p.year, m, 1, 0, 0) : wall(p.year + 1, c.month.values[0], 1, 0, 0);
    } else if (!dayMatches(c, p.day, p.weekday)) {
      next = wall(p.year, p.month, p.day + 1, 0, 0);
    } else if (!c.hour.set.has(p.hour)) {
      const h = nextIn(c.hour.values, p.hour);
      next = h !== undefined ? wall(p.year, p.month, p.day, h, 0) : wall(p.year, p.month, p.day + 1, 0, 0);
    } else if (!c.minute.set.has(p.minute)) {
      const m = nextIn(c.minute.values, p.minute);
      next = m !== undefined ? wall(p.year, p.month, p.day, p.hour, m) : wall(p.year, p.month, p.day, p.hour + 1, 0);
    } else {
      const key = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
      next = t + 60000;
    }
    // Always move forward, even when a wall-clock jump maps back (DST overlap).
    t = Math.floor((next > t ? next : t + 60000) / 60000) * 60000;
  }
  return out;
}

// ---------- English description ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const time = (h: number, m: number) => `${pad2(h)}:${pad2(m)}`;

interface Describer {
  unit: string;
  plural: string;
  fmt: (v: number) => string;
}

const MINUTE_D: Describer = { unit: 'minute', plural: 'minutes', fmt: String };
const HOUR_D: Describer = { unit: 'hour', plural: 'hours', fmt: String };
const DOM_D: Describer = { unit: 'day-of-month', plural: 'days-of-month', fmt: String };
const MONTH_D: Describer = { unit: 'month', plural: 'months', fmt: (v) => MONTH_NAMES[v - 1] };
const DOW_D: Describer = { unit: 'day-of-week', plural: 'days-of-week', fmt: (v) => DAY_NAMES[v % 7] };

/** Describe one item, e.g. "every 2nd hour from 9 through 17". */
function describePart(p: CronPart, d: Describer, named: boolean): string {
  if (p.single) return d.fmt(p.start);
  if (named && !p.star && p.step === 1) return `${d.fmt(p.start)} through ${d.fmt(p.end)}`;
  const stepText = p.step === 1 ? `every ${d.unit}` : `every ${ordinal(p.step)} ${d.unit}`;
  if (p.star) return stepText;
  return `${stepText} from ${d.fmt(p.start)} through ${d.fmt(p.end)}`;
}

/** Describe a whole field. Named fields (month, day-of-week) list names without the unit word. */
function describeField(f: CronField, d: Describer, named: boolean): string {
  if (f.parts.every((p) => p.single)) {
    const vals = f.parts.map((p) => d.fmt(p.start));
    if (named) return joinList(vals);
    return `${vals.length === 1 ? d.unit : d.plural} ${joinList(vals)}`;
  }
  return joinList(f.parts.map((p) => (p.single && !named ? `${d.unit} ${d.fmt(p.start)}` : describePart(p, d, named))));
}

function describeTime(c: CronExpr): string {
  const { minute, hour } = c;
  const singleMin = minute.parts.every((p) => p.single);
  const singleHour = hour.parts.every((p) => p.single);
  if (singleMin && singleHour && minute.values.length * hour.values.length <= 6) {
    const times: string[] = [];
    for (const h of hour.values) for (const m of minute.values) times.push(time(h, m));
    return `At ${joinList(times)}`;
  }
  let minText: string;
  const mp = minute.parts[0];
  if (minute.parts.length === 1 && mp.star) minText = mp.step === 1 ? 'every minute' : `every ${mp.step} minutes`;
  else if (singleMin) minText = `at ${describeField(minute, MINUTE_D, false)}`;
  else minText = describeField(minute, MINUTE_D, false);

  let hourText: string;
  if (hour.full && hour.parts.every((p) => p.star && p.step === 1)) hourText = singleMin ? ' of every hour' : '';
  else hourText = ` past ${describeField(hour, HOUR_D, false)}`;
  const s = minText + hourText;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function describeCron(c: CronExpr): string {
  const pieces = [describeTime(c)];
  const dom = c.dayOfMonth;
  const dow = c.dayOfWeek;
  const domRestricted = !dom.full;
  const dowRestricted = !dow.full;
  const domText = `on ${describeField(dom, DOM_D, false)}`;
  const dowText = `on ${describeField(dow, DOW_D, true)}`;
  if (domRestricted && dowRestricted) {
    if (dom.startsWithStar || dow.startsWithStar) pieces.push(`${domText}, if it is also ${describeField(dow, DOW_D, true)}`);
    else pieces.push(`${domText} or ${dowText}`);
  } else if (domRestricted) pieces.push(domText);
  else if (dowRestricted) pieces.push(dowText);
  if (!c.month.full) pieces.push(`in ${describeField(c.month, MONTH_D, true)}`);
  return pieces.join(', ');
}

/** Human-readable list of the values a field allows, for the breakdown table. */
export function fieldValuesText(f: CronField, name: FieldName): string {
  if (f.full) return 'every value';
  const fmt = name === 'month' ? (v: number) => MONTH_NAMES[v - 1].slice(0, 3) : name === 'dayOfWeek' ? (v: number) => DAY_NAMES[v].slice(0, 3) : String;
  const vals = f.values.map(fmt);
  return vals.length > 24 ? `${vals.slice(0, 24).join(', ')}, … (${vals.length} values)` : vals.join(', ');
}
