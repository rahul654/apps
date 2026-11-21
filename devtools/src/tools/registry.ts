// Single source of truth for tools: drives the sidebar, the home grid and the routes.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export interface SubTool {
  path: string; // relative to the tool, '' for the default mode
  name: string;
  keywords?: string[];
}

export interface ToolDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  keywords: string[];
  component: LazyExoticComponent<ComponentType>;
  sub?: SubTool[];
}

export const TOOLS: ToolDef[] = [
  {
    id: 'json',
    name: 'JSON',
    icon: '{ }',
    description: 'Format, minify, validate, sort keys, tree view and structural diff.',
    keywords: ['pretty', 'beautify', 'lint', 'validate', 'tree', 'diff', 'compare', 'minify'],
    component: lazy(() => import('./JsonTool')),
    sub: [
      { path: '', name: 'Format & validate' },
      { path: 'diff', name: 'JSON diff', keywords: ['compare'] },
    ],
  },
  {
    id: 'base64',
    name: 'Base64',
    icon: '64',
    description: 'Encode and decode text (UTF-8, URL-safe) and files ⇄ data URLs.',
    keywords: ['encode', 'decode', 'data url', 'file', 'image', 'atob', 'btoa'],
    component: lazy(() => import('./Base64Tool')),
    sub: [
      { path: '', name: 'Text' },
      { path: 'file', name: 'File', keywords: ['data url', 'image', 'download'] },
    ],
  },
  {
    id: 'url',
    name: 'URL',
    icon: '%',
    description: 'Percent-encode / decode and parse URLs into editable query params.',
    keywords: ['encode', 'decode', 'percent', 'query', 'params', 'parse', 'uri'],
    component: lazy(() => import('./UrlTool')),
    sub: [
      { path: '', name: 'Encode / decode' },
      { path: 'parse', name: 'Parse & edit', keywords: ['query string', 'params'] },
    ],
  },
  {
    id: 'jwt',
    name: 'JWT decoder',
    icon: 'JWT',
    description: 'Decode header & payload, check expiry, verify HS256/384/512 signatures.',
    keywords: ['token', 'jsonwebtoken', 'bearer', 'hmac', 'verify', 'exp', 'claims', 'oauth'],
    component: lazy(() => import('./JwtTool')),
  },
  {
    id: 'timestamp',
    name: 'Timestamp',
    icon: '⏱︎',
    description: 'Unix seconds/ms ⇄ ISO, local, UTC and relative time in any time zone.',
    keywords: ['epoch', 'unix', 'date', 'time', 'iso', 'timezone', 'utc', 'now'],
    component: lazy(() => import('./TimestampTool')),
  },
  {
    id: 'regex',
    name: 'Regex tester',
    icon: '.*',
    description: 'Live match highlighting, groups, replace preview — safe from runaway patterns.',
    keywords: ['regexp', 'regular expression', 'match', 'replace', 'groups', 'pattern'],
    component: lazy(() => import('./RegexTool')),
  },
  {
    id: 'cron',
    name: 'Cron explainer',
    icon: '↻',
    description: 'Explain 5-field cron expressions in English and list the next runs.',
    keywords: ['crontab', 'schedule', 'job', 'next run', 'quartz'],
    component: lazy(() => import('./CronTool')),
  },
  {
    id: 'uuid',
    name: 'UUID / ID',
    icon: 'ID',
    description: 'Generate UUID v4 and v7 in bulk; validate and inspect any UUID.',
    keywords: ['guid', 'uuid4', 'uuid7', 'random', 'id', 'generate', 'validate'],
    component: lazy(() => import('./UuidTool')),
  },
  {
    id: 'hash',
    name: 'Hash',
    icon: '#',
    description: 'MD5, SHA-1/256/384/512 and HMAC for text or files.',
    keywords: ['md5', 'sha', 'sha1', 'sha256', 'sha512', 'hmac', 'checksum', 'digest'],
    component: lazy(() => import('./HashTool')),
    sub: [
      { path: '', name: 'Text' },
      { path: 'file', name: 'File', keywords: ['checksum'] },
    ],
  },
  {
    id: 'diff',
    name: 'Text diff',
    icon: '±',
    description: 'Side-by-side or inline line diff with word-level highlights.',
    keywords: ['compare', 'difference', 'patch', 'unified', 'changes'],
    component: lazy(() => import('./DiffTool')),
  },
  {
    id: 'converters',
    name: 'Converters',
    icon: '⇄',
    description: 'Number bases, colours (HEX/RGB/HSL/OKLCH), case styles and HTML entities.',
    keywords: ['convert'],
    component: lazy(() => import('./ConvertersTool')),
    sub: [
      { path: '', name: 'Number base', keywords: ['binary', 'hex', 'octal', 'decimal', 'bigint'] },
      { path: 'color', name: 'Color', keywords: ['colour', 'hex', 'rgb', 'hsl', 'oklch', 'contrast', 'wcag'] },
      { path: 'case', name: 'Case', keywords: ['camel', 'snake', 'kebab', 'pascal', 'title', 'constant'] },
      { path: 'html', name: 'HTML entities', keywords: ['escape', 'unescape', 'entity', 'amp'] },
    ],
  },
];

export const toolPath = (t: ToolDef, sub = '') => `/${t.id}${sub ? `/${sub}` : ''}`;

export function findTool(id: string | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** All whitespace-separated terms must match the tool's name/description/keywords (or a sub-tool's). */
export function searchTools(query: string): ToolDef[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return TOOLS;
  return TOOLS.filter((t) => {
    const hay = [t.id, t.name, t.description, ...t.keywords, ...(t.sub ?? []).flatMap((s) => [s.name, ...(s.keywords ?? [])])].join(' ').toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}
