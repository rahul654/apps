# apps

A single git repo holding several small web apps, published together on GitHub Pages.

| URL | What's served | Source |
| --- | --- | --- |
| https://rahul654.github.io/apps/ | Landing page listing the apps | [index.html](index.html) |
| https://rahul654.github.io/apps/splitwise/ | Splitwise clone (React + TypeScript, data in localStorage) | [splitwise/](splitwise/) |
| https://rahul654.github.io/apps/devtools/ | Developer utilities: JSON, Base64, URL, JWT, timestamp, regex, cron, UUID, hash, diff, converters | [devtools/](devtools/) |
| https://rahul654.github.io/apps/filetools/ | PDF editor and organiser, OCR (image to text, searchable PDFs), image compressor/converter, QR generator/scanner, all processed in the browser | [filetools/](filetools/) |
| https://rahul654.github.io/apps/recorder/ | Loom-style screen and webcam recorder with a local library, trim and MP4/WebM export, plus screenshots you can highlight, mark up, blur and crop | [recorder/](recorder/) |
| https://rahul654.github.io/apps/transcribe/ | Speech to text with Whisper running in the browser (WebGPU or WASM): upload or record, streaming results, transcript editor synced to playback, TXT/SRT/VTT/JSON export, local library | [transcribe/](transcribe/) |
| https://rahul654.github.io/apps/whiteboard/ | Excalidraw-based whiteboard and diagrams: boards library with previews, templates, Mermaid to diagram, PNG/SVG/.excalidraw export and backup, stored in IndexedDB | [whiteboard/](whiteboard/) |
| https://rahul654.github.io/apps/apiclient/ | Postman-style API client: collections/environments in Postman v2.1 format, pre-request and test scripts (pm.* subset, chai), collection runner with data files, JSON compare, latency stats and reports, workspace zip export/import, optional dependency-free local proxy for CORS/cookies/timing | [apiclient/](apiclient/) |
| https://rahul654.github.io/apps/drop/ | Phone ⇄ laptop file and text transfer over WebRTC: pair with two QR codes (compact codes, no signalling server), direct encrypted data channel, any file size, progress/cancel, previews | [drop/](drop/) |
| https://rahul654.github.io/apps/files/ | Shared photos, videos, files and text notes stored in a Google Drive folder through a Google Apps Script: anyone with the link views (no login, not behind the site password); uploading, adding text and deleting need an upload password (12-hour login). Smallest-first chunked uploads, 1 GB cap, permanent delete | [files/](files/) |
| https://rahul654.github.io/apps/music/ | Music Hooks: plays the most-replayed ("viral") parts of songs from YouTube playlists, grouped into categories, through the YouTube player; peaks come from YouTube's "Most replayed" data and are kept in a JSON file in the repo; any song can be switched to play in full. Not behind the site password | [music/](music/) |

> GitHub Pages serves a repo named `apps` at `https://<user>.github.io/apps/`, so the repo name *is* the `/apps` part of the URL.
> The bare root `https://rahul654.github.io/` is served by a different repo named `rahul654.github.io`. If you want a page there, create that repo separately.

---

## Password

Every page except **Files** and **Music** asks for one shared password and stays unlocked for 12 hours in that browser. The password is checked by a small **Google Apps Script** that runs free on Google as your account. Change it there at any time; nothing in this repo changes and nothing is redeployed.

**This keeps casual visitors out; it isn't real access control.** GitHub Pages serves every file to anyone who asks for it directly.

### Set up the Apps Script (once, ~5 minutes)

1. Go to https://script.google.com → **New project**. Name it e.g. `apps-gate`.
2. Delete what's in `Code.gs` and paste the whole of [gate/apps-script.gs](gate/apps-script.gs). Press **Save** (💾).
3. **Project Settings** (⚙ on the left) → **Script properties** → **Add script property**: Property `PASSWORD`, Value = your password → **Save script properties**.
4. **Deploy → New deployment** → ⚙ next to "Select type" → **Web app**:
   - Description: `apps gate`
   - Execute as: **Me**
   - Who has access: **Anyone** (not "Anyone with Google account")
   - **Deploy**. Google asks to authorise: choose your account → *Advanced* → *Go to apps-gate (unsafe)* → **Allow**. ("Unsafe" only means Google hasn't reviewed your own script.)
5. Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`) and put it in [gate/config.js](gate/config.js) as `GATE_URL`. Commit and push.

### Check that it works

1. **The script answers:** open the `/exec` URL in a browser. You should see `{"ok":true,"service":"apps-gate","configured":true}`. `configured:false` means step 3 is missing; a Google sign-in page means step 4 wasn't "Anyone".
2. **Wrong and right password from a terminal** (`-L` follows Google's redirect):
   ```bash
   curl -sL -H 'Content-Type: text/plain' -d '{"action":"login","password":"wrong"}' '<web app URL>'
   # {"ok":false,"error":"wrong"}
   curl -sL -H 'Content-Type: text/plain' -d '{"action":"login","password":"<your password>"}' '<web app URL>'
   # {"ok":true,"token":"…","ttl":43200000}
   curl -sL -H 'Content-Type: text/plain' -d '{"action":"check","token":"<token from above>"}' '<web app URL>'
   # {"ok":true,"ttl":…}
   ```
3. **The site:** after the deploy, open https://rahul654.github.io/apps/ in a private window → lock screen → a wrong password says "That password isn't right" → the right one opens the page, and every app opens without asking again for 12 hours.
4. **Logging out everyone:** change `PASSWORD` in Script properties. Open tabs lock on their next page load with "The password was changed".

### Change the password

Apps Script → **Project Settings → Script properties** → edit `PASSWORD` → **Save**. It works at once; there's no new deployment to make.

### Good to know

- **Editing the script's code** (not the password) needs **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.
- **30 wrong passwords within 10 minutes** pause all logins for 10 minutes (Apps Script can't see who is asking, so this applies to everyone, you included).
- `SIGNING_SECRET` appears in Script properties after the first login. Leave it alone; deleting it logs everyone out.
- **Trying it locally:** `npm run build`, then `GATE_PASSWORD=test-password-1 npm run gate:mock` (a stand-in for the script on port 4335), set `GATE_URL` in `_site/gate/config.js` to `http://localhost:4335/exec`, and `npm run preview`.

Details: [docs/changelog/2026-11-22-password-gate.md](docs/changelog/2026-11-22-password-gate.md).

---

## Files

https://rahul654.github.io/apps/files/ shows everything in one Google Drive folder to **anyone with the link**. No login, and it's **not behind the site password** (`PUBLIC_APPS` in [gate/inject.mjs](gate/inject.mjs)). Uploading files, adding text and deleting need the **upload password**, and a login lasts 12 hours.

It needs its own Apps Script, separate from the gate's: [files/apps-script/Code.gs](files/apps-script/Code.gs). It runs as you, so it can write to your Drive while the people using the page never sign in to Google. The page sends it the files in pieces of up to 8 MB. The script passes them on to Google Drive and keeps your upload password. The page never sees the password or the Drive upload links.

### Set up the Apps Script (once, ~5 minutes)

1. Go to https://script.google.com → **New project**. Name it e.g. `files-app`.
2. Delete what's in `Code.gs`, paste the whole of [files/apps-script/Code.gs](files/apps-script/Code.gs), and press **Save** (💾).
3. **Project Settings** (⚙) → **Script properties** → **Add script property**:
   - `UPLOAD_PASSWORD` = the password for uploading and deleting (required)
   - `LIMIT_MB` = `1024` (optional; 1024 is the default, i.e. 1 GB)
   - **Save script properties**.
4. Back in the editor, choose the function **`setup`** in the toolbar and press **Run**. Google asks for permission: your account → *Advanced* → *Go to files-app (unsafe)* → **Allow** ("unsafe" only means Google hasn't reviewed your own script). It creates the folder **My Drive › files-app-uploads**, shared "anyone with the link can view". The log shows its link.
5. **Deploy → New deployment** → ⚙ → **Web app**: Execute as **Me**, Who has access **Anyone** → **Deploy**.
6. Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`) into [files/src/config.ts](files/src/config.ts) as `FILES_URL`. Commit and push.

### Check that it works

1. Open the `/exec` URL: `{"ok":true,"service":"files","configured":true}`. `configured:false` means `UPLOAD_PASSWORD` is missing.
2. From a terminal (`-L` follows Google's redirect):
   ```bash
   curl -sL -H 'Content-Type: text/plain' -d '{"action":"list"}' '<web app URL>'
   # {"ok":true,"items":[],"used":0,"limit":1073741824}
   curl -sL -H 'Content-Type: text/plain' -d '{"action":"login","password":"<upload password>"}' '<web app URL>'
   # {"ok":true,"token":"…","ttl":43200000}
   ```
3. On the site: **⬆ Upload** → the password → attach a few files with 📎 (they go smallest first) and send a text. Open the page in a private window: everything is there without any login.

### Using it

- **Viewing (anyone):** tap an item to open it: photos full size, videos and PDFs in Google's player, text with **Copy text**. **Copy link** gives a link straight to that item.
- **Uploading:** 📎 (several files at once), paste images into the text box, or drag files onto the page on a computer. Up to 10 files upload at the same time, smallest first; when one finishes, the next starts. **Keep the page open until it finishes.** It keeps the screen on, and a locked phone pauses the upload, which continues when you come back. A dropped connection retries by itself and continues from the last piece.
- **Text:** type or paste in the box at the bottom and press **Send** (Ctrl+Enter). It's saved as a `.txt` named after its first line.
- **Deleting:** tick items (or **Select all**) → **Delete**, or **Delete** inside an item. **It's permanent: it skips the Drive Trash.** The script only deletes files inside its own folder.
- **12-hour login:** checked every 15 s locally and every 2 minutes with the script, without reloading. When it ends, the upload and delete buttons disappear, a running upload pauses, and the password box appears. After logging in, the upload continues from the last piece Drive has, and the text you'd typed is still there.

### Change the password, the limit or the folder

- **Password:** edit `UPLOAD_PASSWORD` in Script properties. It works at once and signs every device out.
- **Limit:** edit `LIMIT_MB` (`2048` = 2 GB). It works on the next request, with no new deployment, and the page shows it within 30 s. The limit counts the files in the folder plus uploads still in progress. It's only this app's cap: the files still use your Google account's storage (15 GB free, shared with Gmail and Photos).
- **Another folder:** set `FOLDER_ID` (the ID in the folder's URL). Files the script creates are each shared "anyone with the link", so the folder's own sharing doesn't matter.
- **Editing the code** needs **Deploy → Manage deployments → ✏️ → Version: New version**. The URL stays the same.

### Good to know

- Files you add to the folder **in Google Drive itself** show up too. They count toward the limit, and the page can delete them.
- Right after an upload, Google may need a minute to make the thumbnail and to process a video. Until then the card shows an icon and the player says it's still processing.
- An unfinished upload holds its space for 24 hours, or until you cancel it with ✕.
- 30 wrong passwords within 10 minutes pause all logins for 10 minutes.
- **Trying it locally:** `cd files && FILES_PASSWORD=test-pass npm run mock` (a stand-in for the script on port 4336, with an in-memory Drive), then `VITE_FILES_URL=http://localhost:4336/exec VITE_FILES_MEDIA=http://localhost:4336 npm run dev`.

Details: [docs/changelog/2026-11-22-files-app.md](docs/changelog/2026-11-22-files-app.md).

---

## Music

https://rahul654.github.io/apps/music/ plays the most-replayed part of each song (its "hook") from YouTube playlists, one category per playlist. It's **not behind the site password** (`PUBLIC_APPS` in [gate/inject.mjs](gate/inject.mjs)): it only shows public YouTube videos.

- **Modes:** *Hooks* plays each song's top clip, *All peaks* plays every peak of a song (up to 3), *Full song* plays songs whole. The **Full song** switch on a song overrides the mode for that song only, and flipping it while the clip plays carries on from the same second. Your choices stay in this browser.
- **Where the clips come from:** YouTube's "Most replayed" graph, read with `yt-dlp`. The song list, clips and graphs live in [music/src/data/catalog.json](music/src/data/catalog.json); the playlists and categories in [music/scripts/playlists.json](music/scripts/playlists.json).
- **Refreshing or adding songs** (needs `yt-dlp` on your machine; not run by the build): `cd music && npm run extract` (`--per-category 10`, `--only <categoryId>`, `--dry-run`). Hand-fixed names and clips marked `"edited": true` are kept. Commit `catalog.json` afterwards.
- **Limits:** the first play needs a tap (browsers block autoplay); on a phone, YouTube stops when the screen locks or the tab is in the background; the video stays visible, as YouTube's terms require. A video whose owner blocks embedding is skipped.

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
npm run build        # builds changed apps into _site/ (unchanged ones come from .build-cache/)
npm run preview      # http://localhost:4173/apps/  and  /apps/splitwise/
node scripts/build-site.mjs --no-cache   # rebuild and test every app
```

**Only changed apps are rebuilt.** Each app gets a fingerprint of its files. When it matches the
last build, that build is reused and the app isn't installed, tested or built again. The same
happens on GitHub Actions, where the builds are kept in the Actions cache. Every deploy still
uploads the whole site, because GitHub Pages replaces the site as a whole. To rebuild everything
on GitHub: **Actions → Deploy to GitHub Pages → Run workflow** and tick *Rebuild and test every
app*. The run page shows which apps were built and which were reused.

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
