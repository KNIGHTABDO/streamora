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
