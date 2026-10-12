# apps

A single git repo holding several small web apps, published together on GitHub Pages.

| URL | What's served | Source |
| --- | --- | --- |
| https://rahul654.github.io/apps/ | Landing page listing the apps | [index.html](index.html) |
| https://rahul654.github.io/apps/splitwise/ | Splitwise clone (React + TypeScript, data in localStorage) | [splitwise/](splitwise/) |

> GitHub Pages serves a repo named `apps` at `https://<user>.github.io/apps/`, so the repo name *is* the `/apps` part of the URL.
> The bare root `https://rahul654.github.io/` is served by a different repo named `rahul654.github.io`. If you want a page there, create that repo separately.

---

## Run locally

```bash
# Work on one app with hot reload
cd splitwise
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests for the split/balance maths

# Build the whole site exactly as GitHub Pages will serve it
cd ..
npm run build        # builds every app into _site/
npm run preview      # http://localhost:4173/apps/  and  /apps/splitwise/
```

Requires Node 20.11 or newer.

---

## Host on GitHub Pages (one-time setup)

This repo deploys itself with GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) on every push to `main`. You don't need a `gh-pages` branch.

1. **Create the repo on GitHub.** Go to https://github.com/new, name it **`apps`**, make it **Public** (Pages on private repos needs a paid plan), and don't add a README, .gitignore or licence.

2. **Push this folder:**
   ```bash
   cd apps                       # this folder
   git add .
   git commit -m "Initial commit: apps monorepo with Splitwise"
   git remote add origin https://github.com/rahul654/apps.git
   git push -u origin main
   ```

3. **Turn on Pages with Actions as the source.** In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Don't pick "Deploy from a branch".

4. **Wait for the deploy.** Open the **Actions** tab. The *Deploy to GitHub Pages* run takes about a minute. If the first run started before step 3 and failed, click **Re-run all jobs**.

5. **Open the site:**
   - https://rahul654.github.io/apps/
   - https://rahul654.github.io/apps/splitwise/

After that, every `git push` to `main` rebuilds and redeploys automatically. You can also trigger it by hand from **Actions → Deploy to GitHub Pages → Run workflow**.

### Alternative: the `gh-pages` branch method

You probably used this for `next-stuff`. It works too, but you have to run it by hand each time:

```bash
npm run build                         # creates _site/
npx gh-pages -d _site --dotfiles      # pushes _site/ to the gh-pages branch
```
Then set **Settings → Pages → Source** to **Deploy from a branch**, branch `gh-pages`, folder `/ (root)`.
Use either this or the Actions workflow, not both. If you switch to this method, delete `.github/workflows/deploy.yml`.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| 404 at `/apps/` | Pages source isn't set to **GitHub Actions**, or the workflow hasn't finished yet. |
| Blank page, 404s for `/assets/...` in the console | The app's build isn't using relative paths. Vite apps need `base: './'` in `vite.config.ts`. |
| Refreshing a deep link 404s | Use hash routing (`/#/groups/123`). GitHub Pages can't serve SPA fallbacks. |
| Workflow fails at `npm ci` | Commit the app's `package-lock.json`. |
| Old version still showing | Hard-refresh. Pages CDN caching can take a minute or two. |

---

## Adding another app

1. Create a folder at the repo root, e.g. `todo/`, with a `package.json` whose `build` script writes to `todo/dist/`.
2. Make it work from a sub-path: use relative assets (Vite: `base: './'`) and hash routing.
3. Add a card for it in [index.html](index.html).
4. Push. `scripts/build-site.mjs` finds the new folder by itself and publishes it at `/apps/todo/`.

See [CLAUDE.md](CLAUDE.md) for the full conventions.
