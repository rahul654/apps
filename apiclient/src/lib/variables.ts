/**
 * `{{variable}}` resolution with Postman's precedence (highest first):
 * local (pm.variables.set) > iteration data > environment > request > folder > collection > globals.
 * Dynamic variables ($guid, $timestamp, $randomInt, …) are generated per use.
 */
import { uuid } from './id';

export type VarMap = Record<string, string>;

export interface Scopes {
  local?: VarMap;
  data?: VarMap;
  environment?: VarMap;
  /** Request, then enclosing folders innermost-first, then collection. */
  collectionChain?: VarMap[];
  globals?: VarMap;
}

export function scopeOrder(s: Scopes): VarMap[] {
  return [s.local ?? {}, s.data ?? {}, s.environment ?? {}, ...(s.collectionChain ?? []), s.globals ?? {}];
}

export function lookup(name: string, s: Scopes): string | undefined {
  for (const m of scopeOrder(s)) if (Object.prototype.hasOwnProperty.call(m, name)) return m[name];
  return undefined;
}

/** All variables flattened with precedence applied. */
export function flatten(s: Scopes): VarMap {
  const out: VarMap = {};
  for (const m of scopeOrder(s).reverse()) Object.assign(out, m);
  return out;
}

const DYNAMIC: Record<string, () => string> = {
  $guid: () => uuid(),
  $randomUUID: () => uuid(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1001)),
  $randomBoolean: () => (Math.random() < 0.5 ? 'true' : 'false'),
  $randomAlphaNumeric: () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)],
  $randomColor: () => ['red', 'green', 'blue', 'yellow', 'purple', 'orange'][Math.floor(Math.random() * 6)],
  $randomEmail: () => `user${Math.floor(Math.random() * 10000)}@example.com`,
  $randomFirstName: () => ['Asha', 'Ravi', 'Mia', 'Noah', 'Priya', 'Omar'][Math.floor(Math.random() * 6)],
  $randomLastName: () => ['Shah', 'Khan', 'Patel', 'Lee', 'Silva', 'Novak'][Math.floor(Math.random() * 6)],
  $randomFullName: () => `${DYNAMIC.$randomFirstName()} ${DYNAMIC.$randomLastName()}`,
  $randomUserName: () => `user_${Math.random().toString(36).slice(2, 8)}`,
  $randomPassword: () => Math.random().toString(36).slice(2, 12),
  $randomCity: () => ['Mumbai', 'Dubai', 'Lisbon', 'Osaka', 'Nairobi'][Math.floor(Math.random() * 5)],
  $randomCountry: () => ['India', 'UAE', 'Portugal', 'Japan', 'Kenya'][Math.floor(Math.random() * 5)],
  $randomUrl: () => `https://example.com/${Math.random().toString(36).slice(2, 8)}`,
  $randomIP: () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.'),
  $randomWord: () => ['alpha', 'bravo', 'charlie', 'delta', 'echo'][Math.floor(Math.random() * 5)],
  $randomWords: () => `${DYNAMIC.$randomWord()} ${DYNAMIC.$randomWord()} ${DYNAMIC.$randomWord()}`,
  $randomLoremSentence: () => 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  $randomDateRecent: () => new Date(Date.now() - Math.random() * 864e5).toISOString(),
  $randomDateFuture: () => new Date(Date.now() + Math.random() * 365 * 864e5).toISOString(),
};

export const DYNAMIC_VARIABLES = Object.keys(DYNAMIC);

export const VAR_RE = /\{\{([^{}]+)\}\}/g;

export interface ResolveResult {
  text: string;
  /** Variables that were referenced but not found in any scope. */
  missing: string[];
}

/** Replaces `{{name}}` in `text`. Nested references resolve up to 10 levels deep; unknown ones stay as written. */
export function resolve(text: string, scopes: Scopes): ResolveResult {
  const missing = new Set<string>();
  let out = text;
  for (let depth = 0; depth < 10; depth++) {
    let changed = false;
    out = out.replace(VAR_RE, (whole, rawName: string) => {
      const name = rawName.trim();
      if (name.startsWith('$') && DYNAMIC[name]) {
        changed = true;
        return DYNAMIC[name]();
      }
      const v = lookup(name, scopes);
      if (v === undefined) {
        missing.add(name);
        return whole;
      }
      changed = true;
      return v;
    });
    if (!changed) break;
  }
  return { text: out, missing: [...missing] };
}

export function resolveText(text: string, scopes: Scopes): string {
  return resolve(text, scopes).text;
}

/** Names referenced in a string. */
export function referencedVariables(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) names.add(m[1].trim());
  return [...names];
}

export function varsFromList(list: { key?: string | null; value?: unknown; enabled?: boolean; disabled?: boolean }[] | undefined): VarMap {
  const out: VarMap = {};
  for (const v of list ?? []) {
    if (!v.key || v.disabled || v.enabled === false) continue;
    out[v.key] = v.value === undefined || v.value === null ? '' : typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
  }
  return out;
}
