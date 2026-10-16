# Import into Postman from the API Client

`import-to-postman.mjs` uploads collections, environments and globals into Postman **through the
Postman API**, with every value exactly as in your files.

Why not Postman's own **Import** screen? Its secret scanner empties values that look like
credentials (Basic auth, bearer tokens, API keys), even when you choose *Override*, and large
imports can fail part-way. The API path has neither problem.

The quickest way is the **Postman export & import** page in the API Client (Data → "Postman export
& import"): fill in the fields and copy the one-line command. This guide explains each step.

## Before you start

- **Node.js 18+** on your computer (`node --version`).
- **A file to import.** Any of these works:
  - an API Client export: Data → **Export all workspaces** (or one workspace);
  - a zip made by `export-from-postman.mjs`;
  - an unzipped folder of either;
  - a single `.postman_collection.json`, `.postman_environment.json` or `.postman_globals.json`.

## Step 1: create a Postman API key in the right team

A Postman login can belong to several teams, and **a key only sees the team you're in when you
create it.** Uploads go into that team.

1. Open https://postman.co, click your **avatar** (top right).
2. Under your email you'll see the current team (e.g. "acme · Free plan"). If it's not the team you
   want, click **Switch to ›** and pick it. The address bar changes to the team's domain, e.g.
   `https://acme-jane.postman.co`.
3. Go to **`https://<team-domain>/settings/me/api-keys`**, e.g.
   `https://acme-jane.postman.co/settings/me/api-keys`.
   (Not "Postman keys" in team settings: that's an Enterprise admin page.)
4. Click **Generate API Key**, name it (e.g. `import-acme`), and copy it. It starts with `PMAK-`.

## Step 2: run the import

Copy the command from the Postman page, or type it. macOS / Linux:

```bash
curl -fsSL https://rahul654.github.io/apps/apiclient/import-to-postman.mjs -o /tmp/import-to-postman.mjs && node /tmp/import-to-postman.mjs "$HOME/Downloads/apiclient-all-workspaces.zip" --per-workspace
```

Windows (PowerShell):

```powershell
iwr https://rahul654.github.io/apps/apiclient/import-to-postman.mjs -OutFile "$env:TEMP\import-to-postman.mjs"; node "$env:TEMP\import-to-postman.mjs" "$HOME\Downloads\apiclient-all-workspaces.zip" --per-workspace
```

From a checkout of this repo you can also run `node apiclient/scripts/import-to-postman.mjs …`
(after `npm install` in `apiclient/`).

When it starts it asks: **"Paste your Postman API key (input hidden)"**. Paste and press Enter.
Nothing is shown while you paste; that's intended. (Or set `POSTMAN_API_KEY` beforehand.)

### Choose where things go (one of the two is required)

| Option | What it does |
| --- | --- |
| `--per-workspace` | One Postman workspace per workspace in the file, by name. Missing ones are created. |
| `--workspace "Orders"` | Everything into the one Postman workspace called "Orders" (created if missing). A workspace id works too. |

### Other options

| Option | What it does |
| --- | --- |
| `--dry-run` | Shows what would happen and writes nothing. |
| `--skip-existing` | Leaves collections and environments that already exist (same name) untouched. |
| `--yes` | Doesn't ask for confirmation. |

### What you'll see

```
Account: jane (team acme)

▶ Orders (existing workspace)
  update         environment orders-uat
  create         collection  Orders API

▶ Payments (new workspace, will be created)
  create         collection  Billing

Apply these 4 change(s) to Postman? [y/N] y
…
✔ 4 change(s) applied, 0 failed (14 API calls).
```

The first line shows which account and team the key belongs to. If it's wrong, press Enter
(answers "no"), go back to step 1 and create the key in the right team.

## How existing items are handled

- **Same name already in that workspace → updated in place** (no duplicates). Run it again any
  time; it converges.
- With `--skip-existing`, existing items are left as they are and only new ones are added.
- Two items with the same name in the target workspace → skipped and reported, since it's unclear
  which to update.
- **Globals are merged:** keys from the file overwrite the same keys in Postman; other keys stay.
- Collection, item and response ids are removed before upload and Postman assigns new ones. Ids
  from another account or a deleted copy would otherwise make Postman refuse the upload.
- App-only data (history, run reports, `_apiclient/`, `manifest.json`) is ignored.

## Step 3: delete the key

Back on `https://<team-domain>/settings/me/api-keys`, delete the key.

## Troubleshooting

| Message | What to do |
| --- | --- |
| `The API key was rejected (401)` | The key was mistyped or deleted. Create a new one (step 1). |
| `More than one Postman workspace is called "X"` | Pass the workspace id instead: `--workspace <id>` (the id is in the workspace's URL). |
| `has no workspace in the export. Use --workspace "Name"` | The file has no workspace structure (e.g. a single collection). Use `--workspace`. |
| `Can't reach the Postman API` | Check the internet connection, VPN or proxy. |
| Postman shows "Secrets detected" afterwards | Choose **Override**. The values are already saved. |
