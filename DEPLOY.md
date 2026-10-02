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
   Do the [Google sign-in](#google-sign-in-required) setup once before the first deploy.
   Run this from the **Streamora folder** (not `dist`), so wrangler also uploads the `functions/` relay.
3. Open the printed URL, sign in with Google, paste your Real-Debrid key (only once: it's saved in your Drive), and make a profile.

To update later, run the same two commands again (`build` + `deploy`).

## Option B: from GitHub (auto-deploys on every push)
1. Push this folder to a GitHub repo (the `.gitignore` already skips `tools/node_modules`, `tools/.rdkey`, `.dev.vars` and `dist`).
2. Go to Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repo.
3. Build command: `node tools/build.mjs` · Build output directory: `dist` · Root directory: *(leave empty)*
4. Deploy.

## On your iPhone
Open the URL in Safari → Share → **Add to Home Screen**. Streamora then launches full screen like a real app.

## Checks
- `https://<your-site>/api/rd/time` should return the Real-Debrid server time. That means the relay works.
- If playback fails for one title, open the source picker in the player and try another `[RD+]` source.

## Google sign-in (required)
Streamora keeps everything in each user's Google Drive, so the Google OAuth app has to be set up once. The current one is the Google Cloud project **Streamora** (`streamora-510411`, account knight007youtu@gmail.com):
- Google Drive API enabled; Google Auth Platform → **In production**, External; scopes `openid`, `email`, `profile`, `drive.file` (all non-sensitive, so no verification needed); privacy policy `https://<site>/privacy.html`.
- Client **Streamora web** (Web application): JavaScript origins and redirect URIs `https://streamora-5w5.pages.dev` + `/` and `http://localhost:5173` + `/`.
- Client **Streamora TV and iPhone app** (TVs and Limited Input devices): the "enter a code at google.com/device" sign-in.

The client ids are public and live in `wrangler.toml` `[vars]`. The two secrets are Pages secrets. Set them (and `.dev.vars` for local dev) with:
```bash
node tools/google-secrets.mjs
```
Lost a secret? Google Auth Platform → Clients → the client → **Add secret**, then run the script again.
A new domain (or another port locally) has to be added to the web client's origins and redirect URIs. LAN addresses like `192.168.x.x` can't be added, so phones on your Wi-Fi sign in with the code instead.
Check: `https://<your-site>/api/google/config` shows both client ids (`null` means that client's secret is missing).

## Optional extras
These are off until you set them up. The app works fine without them.

### Trakt (scrobbling + history import)
1. Go to https://trakt.tv/oauth/applications → **New application**. Name: Streamora. Redirect URI: `urn:ietf:wg:oauth:2.0:oob`. Save.
2. Pages project → Settings → **Variables and secrets** → add `TRAKT_CLIENT_ID` and `TRAKT_CLIENT_SECRET` (as a secret). Redeploy.
3. In the app: Settings → Connect → Trakt → Connect, then enter the code shown on trakt.tv/activate.

Only the sign-in calls go through `/api/trakt` (they need the secret). Check: `https://<your-site>/api/trakt/config` returns your client id.
For local dev: `TRAKT_CLIENT_ID=… TRAKT_CLIENT_SECRET=… node dev-server.mjs`.

### Stremio addons
Nothing to set up. Add addon links in Settings → Connect. Addons without CORS go through `/api/addon` (read-only JSON relay, https and public hosts only).
