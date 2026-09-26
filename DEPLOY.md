# Deploy Streamora to Cloudflare Pages (free)

You get one URL like `https://streamora.pages.dev` that works on your iPhone, TV and laptop from anywhere.

## Option A: from your PC (fastest)
1. Make a free account at https://dash.cloudflare.com/sign-up
2. In the `Streamora` folder:
   ```bash
   node tools/build.mjs
   npx wrangler login                                      # opens the browser once
   npx wrangler pages deploy dist --project-name streamora
   ```
   Run this from the **Streamora folder** (not `dist`), so wrangler also uploads the `functions/` relay.
3. Open the printed URL, paste your Real-Debrid key, and make a profile.

To update later, run the same two commands again (`build` + `deploy`).

## Option B: from GitHub (auto-deploys on every push)
1. Push this folder to a GitHub repo (the `.gitignore` already skips `tools/node_modules`, `tools/.rdkey` and `dist`).
2. Go to Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repo.
3. Build command: `node tools/build.mjs` · Build output directory: `dist` · Root directory: *(leave empty)*
4. Deploy.

## On your iPhone
Open the URL in Safari → Share → **Add to Home Screen**. Streamora then launches full screen like a real app.

## Checks
- `https://<your-site>/api/rd/time` should return the Real-Debrid server time. That means the relay works.
- If playback fails for one title, open the source picker in the player and try another `[RD+]` source.

## Optional extras
All of these are off until you set them up. The app works fine without them.

### Sync between devices (Cloudflare KV)
1. Dashboard → Storage & Databases → **KV** → Create namespace, e.g. `streamora-sync`.
2. Your Pages project → Settings → **Bindings** → Add → KV namespace. Variable name **`SYNC`**, pick the namespace. Redeploy.
3. In the app: Settings → Connect → Sync, then enter the same passphrase on each device.

The server only stores one encrypted blob per passphrase (512 KB max) and can't read it. The Real-Debrid key is never synced.
Check: `https://<your-site>/api/sync/` + 64 zeros returns `{"error":"not_found"}` (and `sync_not_configured` if the binding is missing).

### Trakt (scrobbling + history import)
1. Go to https://trakt.tv/oauth/applications → **New application**. Name: Streamora. Redirect URI: `urn:ietf:wg:oauth:2.0:oob`. Save.
2. Pages project → Settings → **Variables and secrets** → add `TRAKT_CLIENT_ID` and `TRAKT_CLIENT_SECRET` (as a secret). Redeploy.
3. In the app: Settings → Connect → Trakt → Connect, then enter the code shown on trakt.tv/activate.

Only the sign-in calls go through `/api/trakt` (they need the secret). Check: `https://<your-site>/api/trakt/config` returns your client id.
For local dev: `TRAKT_CLIENT_ID=… TRAKT_CLIENT_SECRET=… node dev-server.mjs`.

### Stremio addons
Nothing to set up. Add addon links in Settings → Connect. Addons without CORS go through `/api/addon` (read-only JSON relay, https and public hosts only).
