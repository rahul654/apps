// Builds every app folder and assembles the GitHub Pages site in ./_site
//
//   _site/index.html          ← root index.html   (served at /apps/)
//   _site/<app>/...           ← <app>/dist         (served at /apps/<app>/)
//
// An "app folder" is any top-level directory with a package.json that has a "build" script.
// Each app must build into its own dist/ with relative asset paths (Vite: base './').
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '_site');
const IGNORED = new Set(['node_modules', 'scripts', '_site', 'logs']);

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

const apps = readdirSync(root).filter((name) => {
  if (name.startsWith('.') || IGNORED.has(name)) return false;
  const pkgPath = join(root, name, 'package.json');
  if (!statSync(join(root, name)).isDirectory() || !existsSync(pkgPath)) return false;
  return Boolean(JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.build);
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

for (const app of apps) {
  const dir = join(root, app);
  console.log(`\n▶ ${app}`);
  // Always do a clean install in CI; locally reuse node_modules if present.
  if (process.env.CI || !existsSync(join(dir, 'node_modules'))) {
    run(existsSync(join(dir, 'package-lock.json')) ? 'npm ci' : 'npm install', dir);
  }
  run('npm test --if-present', dir);
  run('npm run build', dir);
  cpSync(join(dir, 'dist'), join(out, app), { recursive: true });
}

for (const file of ['index.html', '404.html']) {
  if (existsSync(join(root, file))) cpSync(join(root, file), join(out, file));
}
writeFileSync(join(out, '.nojekyll'), ''); // stop GitHub Pages running Jekyll over the output

console.log(`\n✔ Built ${apps.length} app(s) into _site/: ${apps.join(', ') || '(none)'}`);
