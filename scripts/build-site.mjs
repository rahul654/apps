// Builds every app folder and assembles the GitHub Pages site in ./_site
//
//   _site/index.html          ← root index.html   (served at /apps/)
//   _site/<app>/...           ← <app>/dist         (served at /apps/<app>/)
//
// An "app folder" is any top-level directory with a package.json that has a "build" script.
// Each app must build into its own dist/ with relative asset paths (Vite: base './').
//
// Only changed apps are rebuilt. Each app gets a fingerprint: a hash of every file in its folder
// that git tracks or would track (so dist/ and node_modules/ are excluded), plus the Node major
// version and this script. A finished build is kept in .build-cache/<app>/<fingerprint>/; when the
// fingerprint matches, that copy goes into _site/ and the app is not installed, tested or built.
// CI restores .build-cache with actions/cache (see .github/workflows/deploy.yml).
//
//   node scripts/build-site.mjs              rebuild changed apps only
//   node scripts/build-site.mjs --no-cache   rebuild everything (also: FORCE_REBUILD=1)
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '_site');
const cacheRoot = join(root, '.build-cache');
const IGNORED = new Set(['node_modules', 'scripts', '_site', 'logs']);
const forceRebuild = process.argv.includes('--no-cache') || /^(1|true|yes)$/i.test(process.env.FORCE_REBUILD ?? '');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

const apps = readdirSync(root).filter((name) => {
  if (name.startsWith('.') || IGNORED.has(name)) return false;
  const pkgPath = join(root, name, 'package.json');
  if (!statSync(join(root, name)).isDirectory() || !existsSync(pkgPath)) return false;
  return Boolean(JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.build);
});

// Anything that changes how every app is built invalidates every cached build.
const globalSalt = `node ${process.versions.node.split('.')[0]}\0${createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex')}`;

/** Hash of the app's files, or null when git isn't available (then nothing is cached). */
function fingerprint(app) {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', app], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      .toString()
      .split('\0')
      .filter(Boolean)
      .sort();
  } catch {
    return null;
  }
  const hash = createHash('sha256').update(globalSalt);
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path) || !statSync(path).isFile()) continue; // tracked but deleted locally
    hash.update(`${file}\0`).update(readFileSync(path)).update('\0');
  }
  return hash.digest('hex').slice(0, 20);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

const results = [];
// Taken once, before building: a build that leaves new files behind must not invalidate its own cache entry.
const fingerprints = new Map();
for (const app of apps) {
  const dir = join(root, app);
  const started = Date.now();
  const fp = fingerprint(app);
  fingerprints.set(app, fp);
  const cached = fp && join(cacheRoot, app, fp);

  if (!forceRebuild && cached && existsSync(cached)) {
    console.log(`\n▶ ${app}: unchanged (${fp}), reusing the cached build`);
    cpSync(cached, join(out, app), { recursive: true });
    results.push({ app, action: 'reused', seconds: (Date.now() - started) / 1000 });
    continue;
  }

  console.log(`\n▶ ${app}: ${forceRebuild ? 'rebuild forced' : fp ? `changed (${fp})` : 'no fingerprint (git unavailable)'}, building`);
  // Always do a clean install in CI; locally reuse node_modules if present.
  if (process.env.CI || !existsSync(join(dir, 'node_modules'))) {
    run(existsSync(join(dir, 'package-lock.json')) ? 'npm ci' : 'npm install', dir);
  }
  run('npm test --if-present', dir);
  run('npm run build', dir);
  cpSync(join(dir, 'dist'), join(out, app), { recursive: true });

  if (cached) {
    // Write next to the final name, then rename, so an interrupted run never leaves a half copy.
    const tmp = `${cached}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    cpSync(join(dir, 'dist'), tmp, { recursive: true });
    rmSync(cached, { recursive: true, force: true });
    renameSync(tmp, cached);
  }
  results.push({ app, action: 'built', seconds: (Date.now() - started) / 1000 });
}

// Keep only the current build of each app, and drop apps that no longer exist.
if (existsSync(cacheRoot)) {
  for (const app of readdirSync(cacheRoot)) {
    if (!apps.includes(app)) {
      rmSync(join(cacheRoot, app), { recursive: true, force: true });
      continue;
    }
    const keep = fingerprints.get(app);
    for (const entry of readdirSync(join(cacheRoot, app))) {
      if (entry !== keep) rmSync(join(cacheRoot, app, entry), { recursive: true, force: true });
    }
  }
}

for (const file of ['index.html', '404.html']) {
  if (existsSync(join(root, file))) cpSync(join(root, file), join(out, file));
}
writeFileSync(join(out, '.nojekyll'), ''); // stop GitHub Pages running Jekyll over the output

const built = results.filter((r) => r.action === 'built').map((r) => r.app);
const reused = results.filter((r) => r.action === 'reused').map((r) => r.app);
console.log(`\n✔ ${apps.length} app(s) in _site/. Built: ${built.join(', ') || 'none'}. Reused unchanged: ${reused.join(', ') || 'none'}.`);

// A table on the GitHub Actions run page.
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((r) => `| ${r.app} | ${r.action === 'built' ? '🔨 built and tested' : '♻️ unchanged, reused'} | ${r.seconds.toFixed(1)} s |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['### Apps', '', '| App | Result | Time |', '| --- | --- | --- |', ...rows, ''].join('\n'));
}
