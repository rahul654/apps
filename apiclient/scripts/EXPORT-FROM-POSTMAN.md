# Export everything from Postman into the API Client

`export-from-postman.mjs` downloads every collection, environment and globals set that a Postman
API key can see, and packs them into one zip. The zip imports in one step on the API Client's
**Data** page (into one app workspace, or one per Postman workspace), and every file inside it is
also a normal Postman file.

The whole run takes about a minute. Most of that is creating the key.

## The one thing to know first: keys are per team

A Postman account can belong to several teams. **An API key only sees the team you were in when
you created it.** It never sees the other teams, even on the same login.

So the steps are always: switch to the right team → create a key there → run the script. One key
per team you want to export.

Example: one login that belongs to three teams.

| Team | Team domain | What's in it |
| --- | --- | --- |
| acme | `acme-jane.postman.co` | the company's collections and environments |
| side-projects | `side-projects-jane.postman.co` | personal collections |
| Jane (individual) | `jane.postman.co` | the default personal team |

A key created while in `acme` exports only `acme`. The other two need their own keys.

## Step 1: switch to the team

1. Open https://postman.co in the browser and sign in.
2. Click your **avatar** (top right).
3. The menu shows the current team under your email (e.g. "acme · Free plan"). If it's not the
   team you want, click **Switch to ›** and pick the team.
4. The address bar changes to that team's domain, e.g. `https://acme-jane.postman.co/home`.
   That domain is the confirmation you're in the right team.

To check what's in the team before exporting: left menu **Workspaces** → open a workspace →
**Collections** / **Environments** in its sidebar. The home page only shows recent items.

## Step 2: create the key

1. Go to **`https://<team-domain>/settings/me/api-keys`**, for example
   `https://acme-jane.postman.co/settings/me/api-keys`.

   Don't use **Postman keys** in the avatar menu or in team settings
   (`/settings/team/postman-keys`). That is an Enterprise admin dashboard, not your keys.
   The `/settings/me/` page is the personal one.
2. Click **Generate API Key**, give it a name (e.g. `export-acme`) and copy it. It starts with
   `PMAK-`.
3. Keep it for the next step only. Don't paste it into files, chats or commits.

## Step 3: run the script

The quickest way is the API Client's **Postman export & import** page (Data → "Postman export &
import"): set the file name and copy the one-line command. macOS / Linux:

```bash
curl -fsSL https://rahul654.github.io/apps/apiclient/export-from-postman.mjs -o /tmp/export-from-postman.mjs && node /tmp/export-from-postman.mjs "$HOME/Downloads/postman-export-acme.zip"
```

Windows (PowerShell):

```powershell
iwr https://rahul654.github.io/apps/apiclient/export-from-postman.mjs -OutFile "$env:TEMP\export-from-postman.mjs"; node "$env:TEMP\export-from-postman.mjs" "$HOME\Downloads\postman-export-acme.zip"
```

From a checkout of this repo: `node apiclient/scripts/export-from-postman.mjs <out.zip>` (after
`npm install` in `apiclient/`).

- It asks **"Paste your Postman API key (input hidden)"**: paste and press Enter. Nothing shows
  while you paste. The key never appears in the command or shell history and is never written
  anywhere. (Setting `POSTMAN_API_KEY` beforehand also works.)
- The output path is optional. Without it the zip goes to
  `~/Downloads/postman-export-<today>.zip`. The script refuses to overwrite an existing file.
- Needs Node.js 18+. The downloaded script is self-contained; nothing else is installed.

What you'll see:

```
Account: jane
2 workspace(s)

▶ Team Workspace (team)
  ✔ Orders API
  ✔ env orders-uat
  …
✔ 15 collection(s), 18 environment(s), 0 globals file(s) → ~/Downloads/postman-export-acme.zip
```

The first line shows which account the key belongs to. If the workspace names or collections
look wrong, the key was created in the wrong team: go back to step 1.

Markers: `✔` exported, `⚠` exported but not strictly valid Postman v2.1 (Postman itself produced
it; it still imports), `✖` skipped (reason listed, and recorded in `manifest.json` inside the zip).

## Step 4: import into the API Client

1. Open the API Client → **Data**.
2. Drop the zip on **Import** (or **Choose files**). The panel lists the Postman workspaces found.
3. Under **Where to**, pick one:
   - **Import everything into one workspace**, then choose the target: **Default** (preselected),
     any existing workspace, or **New workspace…** (name pre-filled from the zip's file name).
   - **Create one workspace per Postman workspace**: each Postman workspace goes into the app
     workspace with the same name (ignoring case), which is created if it doesn't exist.
4. Pick **Merge** to add to what's already there (same ids are updated), or **Replace** to clear
   the target workspace(s) first. Replace never touches other workspaces.
5. Environment values are hidden by default on the Environments page; tick **Show values**.

## Step 5: delete the key

Back on `https://<team-domain>/settings/me/api-keys`, delete the key. The export doesn't need it
any more, and a leaked key gives full access to the team's collections.

## Exporting several teams

Repeat steps 1–5 per team, giving each zip a different name:

```bash
node /tmp/export-from-postman.mjs "$HOME/Downloads/postman-export-acme.zip"           # paste the acme key
node /tmp/export-from-postman.mjs "$HOME/Downloads/postman-export-side-projects.zip"  # paste the side-projects key
```

Import each zip with **Merge**. With **Create one workspace per Postman workspace**, two teams
that both have a workspace called e.g. "My Workspace" end up merged into one app workspace;
import into a **New workspace…** per team instead if you want them apart.

## What's inside the zip

```
collections/<workspace>/<name>.postman_collection.json    Postman Collection v2.1
environments/<workspace>/<name>.postman_environment.json  Postman environment
globals/<workspace>.postman_globals.json                  only when the workspace has globals
manifest.json                                             what was exported, warnings, skipped items
```

Every file opens in Postman too (Import → drop the file), so the zip doubles as a backup.

## Limits

- **Secret variables:** the Postman API returns values of *secret*-type variables masked (empty).
  They're listed under `maskedSecrets` in `manifest.json`; re-enter them in the app. Normal
  variables come through with their values.
- **Only synced data:** anything that exists only in the desktop app (never synced, or in a
  workspace the key can't see) won't be in the zip. Export those items one by one in the desktop
  app: hover the item in the sidebar → **⋯** → **Export**, then import the file on the Data page.
- **Rate limits:** the free plan allows a limited number of API calls per month (roughly one call
  per collection or environment plus a few per workspace). The script retries on 429 responses.
- The desktop app's **Settings → Data** tab no longer offers a full export in Postman 11+
  (only "Export Scratch Pad Data"), which is why this script exists.

## Going the other way

To upload into Postman with every value intact, see [IMPORT-TO-POSTMAN.md](IMPORT-TO-POSTMAN.md).
