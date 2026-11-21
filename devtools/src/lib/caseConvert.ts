// Identifier / text case conversion.

/** Split into words at separators, case changes (fooBar, XMLHttp) and letter/number boundaries kept together. */
export function splitWords(input: string): string[] {
  return input
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const lower = (w: string) => w.toLowerCase();

export type CaseName = 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant' | 'dot' | 'path' | 'title' | 'sentence' | 'lower' | 'upper';

export const CASES: { id: CaseName; label: string; example: string }[] = [
  { id: 'camel', label: 'camelCase', example: 'helloWorld' },
  { id: 'pascal', label: 'PascalCase', example: 'HelloWorld' },
  { id: 'snake', label: 'snake_case', example: 'hello_world' },
  { id: 'kebab', label: 'kebab-case', example: 'hello-world' },
  { id: 'constant', label: 'CONSTANT_CASE', example: 'HELLO_WORLD' },
  { id: 'dot', label: 'dot.case', example: 'hello.world' },
  { id: 'path', label: 'path/case', example: 'hello/world' },
  { id: 'title', label: 'Title Case', example: 'Hello World' },
  { id: 'sentence', label: 'Sentence case', example: 'Hello world' },
  { id: 'lower', label: 'lower case', example: 'hello world' },
  { id: 'upper', label: 'UPPER CASE', example: 'HELLO WORLD' },
];

function convertLine(line: string, to: CaseName): string {
  const w = splitWords(line);
  switch (to) {
    case 'camel':
      return w.map((x, i) => (i === 0 ? lower(x) : cap(x))).join('');
    case 'pascal':
      return w.map(cap).join('');
    case 'snake':
      return w.map(lower).join('_');
    case 'kebab':
      return w.map(lower).join('-');
    case 'constant':
      return w.map((x) => x.toUpperCase()).join('_');
    case 'dot':
      return w.map(lower).join('.');
    case 'path':
      return w.map(lower).join('/');
    case 'title':
      return w.map(cap).join(' ');
    case 'sentence':
      return w.map((x, i) => (i === 0 ? cap(x) : lower(x))).join(' ');
    case 'lower':
      return w.map(lower).join(' ');
    case 'upper':
      return w.map((x) => x.toUpperCase()).join(' ');
  }
}

/** Convert each line independently (so a list of identifiers converts in one go). */
export function convertCase(input: string, to: CaseName): string {
  return input
    .split(/\r?\n/)
    .map((l) => convertLine(l, to))
    .join('\n');
}
