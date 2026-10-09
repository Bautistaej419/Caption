# Deploy CAPTION securely

CAPTION has two deployments:

- **GitHub Pages** hosts the public HTTPS website.
- **Cloudflare Workers** hosts the token endpoint that signs LiveKit room tokens. It is required for calls and keeps the LiveKit API secret out of GitHub and the browser.

## What you need to create

1. A GitHub repository containing this project.
2. A [LiveKit Cloud](https://cloud.livekit.io/) project. Copy its WebSocket URL (`wss://...`), API key, and API secret from the project settings.
3. A [Cloudflare](https://dash.cloudflare.com/sign-up) account for the token Worker.
4. Node.js 20+ installed locally for the one-time Worker deployment.

## 1. Publish the frontend on GitHub Pages

1. Create an empty GitHub repository, then upload/push this project's files to its `main` branch.
2. In the repository, open **Settings → Pages** and select **GitHub Actions** as the source.
3. Push the `main` branch. The included `.github/workflows/deploy-pages.yml` deploys the static site.
4. Wait for the workflow to finish. GitHub shows the resulting URL, normally:

   ```text
   https://<github-user>.github.io/<repository-name>/
   ```

Use this exact HTTPS origin in the Worker configuration below. Do not use an `http://192.168...` LAN address for phone camera/microphone access.

## 2. Deploy the LiveKit token Worker

Open PowerShell in the `worker` folder:

```powershell
npm install
npx wrangler login
```

Edit `worker/wrangler.toml` and set `ALLOWED_ORIGINS` to the exact GitHub Pages origin plus local development. Example:

```toml
ALLOWED_ORIGINS = "https://<github-user>.github.io,http://localhost:5500"
```

Set the three LiveKit values as encrypted Cloudflare secrets. Paste each value only when Wrangler asks for it:

```powershell
npx wrangler secret put LIVEKIT_URL
npx wrangler secret put LIVEKIT_API_KEY
npx wrangler secret put LIVEKIT_API_SECRET
npm run deploy
```

The final command prints a Worker address such as:

```text
https://caption-livekit-token.<your-subdomain>.workers.dev
```

Check its public health endpoint in a browser:

```text
https://caption-livekit-token.<your-subdomain>.workers.dev/health
```

It must return `{ "ok": true }`.

## 3. Connect the website to the Worker

In GitHub, open **Settings → Secrets and variables → Actions → Variables**, create this repository variable, and paste the Worker endpoint:

```text
Name:  CAPTION_TOKEN_ENDPOINT
Value: https://caption-livekit-token.<your-subdomain>.workers.dev/token
```

Run the Pages workflow again (or push another commit). The workflow inserts this public URL into the deployed artifact only; the repository keeps `livekit-config.js` blank for safe local copies. The endpoint URL is safe to publish. Do **not** put API keys or API secrets in `livekit-config.js`, `.env.example`, or any GitHub file.

## 4. Test an online call

1. Open the GitHub Pages URL in two browsers/devices.
2. Press **GET STARTED** and allow camera/microphone permission on both.
3. Enter the same room name, for example `caption-123`, then press **Join Call**.
4. The first participant receives a room-invitation link. Use **Copy room link** or **Share Link** to invite another participant.
5. Confirm both devices show remote video, hear remote audio, can send chat/sign data, and can leave/rejoin.

## Local Worker testing (optional)

Copy `worker/.dev.vars.example` to `worker/.dev.vars`, fill in your LiveKit values, and run:

```powershell
npx wrangler dev
```

Set `livekit-config.js` to the local Worker `/token` URL only for local testing. Never commit `worker/.dev.vars`.

## Security checklist

- `LIVEKIT_API_SECRET` exists only as a Cloudflare secret or an ignored local file.
- `ALLOWED_ORIGINS` lists only your website origin(s).
- The Worker `/token` route accepts only trusted origins and short-lived tokens.
- GitHub Pages serves the camera/microphone frontend over HTTPS.
