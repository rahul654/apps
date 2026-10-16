/**
 * One-line commands for the Postman page: download the standalone script shipped next to the app
 * (bundled by vite.config.ts) to a temp folder and run it. The scripts ask for the API key at a
 * hidden prompt, so it is never part of the command.
 */
import type { CommandOs } from '../proxy/control';

/** Quotes for bash/zsh. A leading ~/ becomes $HOME/ because ~ doesn't expand inside quotes. */
export function shQuote(s: string): string {
  const home = s === '~' || s.startsWith('~/');
  const rest = home ? s.slice(1) : s;
  const body = rest.replace(/(["\\$`])/g, '\\$1');
  return home ? `"$HOME${body}"` : `"${body}"`;
}

/** Quotes for PowerShell. A leading ~/ or ~\ becomes $HOME. */
export function psQuote(s: string): string {
  const home = s === '~' || /^~[\\/]/.test(s);
  const rest = home ? s.slice(1) : s;
  const body = rest.replace(/([`"$])/g, '`$1');
  return home ? `"$HOME${body}"` : `"${body}"`;
}

function download(os: CommandOs, scriptUrl: string, file: string): { fetch: string; run: string } {
  if (os === 'windows') {
    const path = `"$env:TEMP\\${file}"`;
    return { fetch: `iwr ${scriptUrl} -OutFile ${path}`, run: `node ${path}` };
  }
  return { fetch: `curl -fsSL ${scriptUrl} -o /tmp/${file}`, run: `node /tmp/${file}` };
}

const join = (os: CommandOs, a: string, b: string) => (os === 'windows' ? `${a}; ${b}` : `${a} && ${b}`);

export function exportCommand({ os, scriptUrl, outFile }: { os: CommandOs; scriptUrl: string; outFile: string }): string {
  const { fetch, run } = download(os, scriptUrl, 'export-from-postman.mjs');
  const q = os === 'windows' ? psQuote : shQuote;
  return join(os, fetch, `${run} ${q(outFile)}`);
}

export interface ImportOptions {
  os: CommandOs;
  scriptUrl: string;
  input: string;
  /** null = --per-workspace */
  workspace: string | null;
  dryRun?: boolean;
  skipExisting?: boolean;
}

export function importCommand({ os, scriptUrl, input, workspace, dryRun, skipExisting }: ImportOptions): string {
  const { fetch, run } = download(os, scriptUrl, 'import-to-postman.mjs');
  const q = os === 'windows' ? psQuote : shQuote;
  const args = [q(input), workspace === null ? '--per-workspace' : `--workspace ${q(workspace)}`];
  if (dryRun) args.push('--dry-run');
  if (skipExisting) args.push('--skip-existing');
  return join(os, fetch, `${run} ${args.join(' ')}`);
}

/** Default download location shown in the fields: ~/Downloads/<name> (PowerShell understands ~ too, via psQuote). */
export const downloadsPath = (name: string, os: CommandOs) => (os === 'windows' ? `~\\Downloads\\${name}` : `~/Downloads/${name}`);
