import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { downloadsPath, exportCommand, importCommand, psQuote, shQuote } from './commands';

const BASE = 'https://rahul654.github.io/apps/apiclient';

describe('quoting', () => {
  it('quotes for bash, expanding a leading ~ via $HOME and escaping specials', () => {
    expect(shQuote('~/Downloads/a b.zip')).toBe('"$HOME/Downloads/a b.zip"');
    expect(shQuote('Team "Q4" $work`')).toBe('"Team \\"Q4\\" \\$work\\`"');
    expect(shQuote('/tmp/x.zip')).toBe('"/tmp/x.zip"');
  });

  it('really survives bash', () => {
    const tricky = 'Team "Q4" $HOME `whoami` \\ end';
    expect(execFileSync('bash', ['-c', `printf %s ${shQuote(tricky)}`]).toString()).toBe(tricky);
    expect(execFileSync('bash', ['-c', `printf %s ${shQuote('~/x y')}`], { env: { ...process.env, HOME: '/home/jane' } }).toString()).toBe('/home/jane/x y');
  });

  it('quotes for PowerShell with backticks', () => {
    expect(psQuote('~\\Downloads\\a b.zip')).toBe('"$HOME\\Downloads\\a b.zip"');
    expect(psQuote('Team "Q4" $x')).toBe('"Team `"Q4`" `$x"');
  });
});

describe('commands', () => {
  it('export: download to temp and run with the output file', () => {
    expect(exportCommand({ os: 'unix', scriptUrl: `${BASE}/export-from-postman.mjs`, outFile: downloadsPath('postman-export.zip', 'unix') })).toBe(
      `curl -fsSL ${BASE}/export-from-postman.mjs -o /tmp/export-from-postman.mjs && node /tmp/export-from-postman.mjs "$HOME/Downloads/postman-export.zip"`,
    );
    expect(exportCommand({ os: 'windows', scriptUrl: `${BASE}/export-from-postman.mjs`, outFile: downloadsPath('postman-export.zip', 'windows') })).toBe(
      `iwr ${BASE}/export-from-postman.mjs -OutFile "$env:TEMP\\export-from-postman.mjs"; node "$env:TEMP\\export-from-postman.mjs" "$HOME\\Downloads\\postman-export.zip"`,
    );
  });

  it('import: one workspace or per workspace, with optional flags', () => {
    const url = `${BASE}/import-to-postman.mjs`;
    expect(importCommand({ os: 'unix', scriptUrl: url, input: '~/Downloads/x.zip', workspace: 'Team Workspace' })).toBe(
      `curl -fsSL ${url} -o /tmp/import-to-postman.mjs && node /tmp/import-to-postman.mjs "$HOME/Downloads/x.zip" --workspace "Team Workspace"`,
    );
    expect(importCommand({ os: 'unix', scriptUrl: url, input: '~/Downloads/x.zip', workspace: null, dryRun: true, skipExisting: true })).toMatch(
      /"\$HOME\/Downloads\/x\.zip" --per-workspace --dry-run --skip-existing$/,
    );
    expect(importCommand({ os: 'windows', scriptUrl: url, input: '~\\Downloads\\x.zip', workspace: 'A' })).toBe(
      `iwr ${url} -OutFile "$env:TEMP\\import-to-postman.mjs"; node "$env:TEMP\\import-to-postman.mjs" "$HOME\\Downloads\\x.zip" --workspace "A"`,
    );
  });
});
