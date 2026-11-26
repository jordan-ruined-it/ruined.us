# ruined.us

Landing page for jordan ruined it — mixing, mastering, production. Static HTML/CSS on Cloudflare Pages, plus one Pages Function that loads the Spotify portfolio playlist server-side.

```
index.html              home: hero, work grid, contact
info.html               services, how to send files, artist list  (served at /info)
cool-shit.html          downloads page (served at /cool-shit)
assets/style.css        all styles (light grayscale palette in :root)
assets/site.js          swaps the static work grid / artist list for live Spotify data
assets/RiverSHINE.ttf   display font
assets/icon.svg        site icon (favicon.ico and apple-touch-icon.png at the root)
assets/studio.jpg       studio photo for /info  (add this file)
functions/api/playlist.js   GET /api/playlist → { tracks, artists }, read fresh on every visit (no cache)
functions/api/spotify-login.js, functions/callback.js   one-time Spotify login (only while SPOTIFY_SETUP=on)
lib/spotify.js              shared Spotify helpers
_headers                cache + security headers
```

The pages work without JavaScript or the API: they ship a static copy of the work grid and artist list, and `site.js` replaces them with the live playlist (with cover art) when `/api/playlist` responds.

## Deploy (Cloudflare Pages)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Build settings: framework preset **None**, build command **empty**, output directory **`/`**.
3. Settings → Variables and Secrets (Production and Preview):
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET` (type: Secret)
   - `SPOTIFY_REFRESH_TOKEN` (type: Secret) — see "Spotify login" below
   - optional `SPOTIFY_PLAYLIST_ID` (defaults to `2USDDnrlxhw82ydTl5TfbN`)
4. Custom domains → add `ruined.us` (and `www.ruined.us` if wanted). Because the zone is already on this Cloudflare account, the DNS records are created for you — delete any old A/AAAA/CNAME records on `ruined.us` first.

Every push to `main` redeploys.

## Spotify login (one time)

Since Spotify's February 2026 rules, newer apps can only read a playlist's contents as its owner, so the site keeps a refresh token for the owner's account.

1. Spotify dashboard → your app → Settings:
   - Redirect URIs: add `https://ruined.us/callback` (and `https://ruined-us.pages.dev/callback` if ruined.us isn't attached yet).
   - User Management: add the playlist owner's account.
2. Cloudflare: add variable `SPOTIFY_SETUP` = `on`, then retry the latest deployment.
3. Open `/api/spotify-login` on the site and log in with the playlist owner's account.
4. The `/callback` page shows a refresh token. Save it as the secret `SPOTIFY_REFRESH_TOKEN`.
5. Delete `SPOTIFY_SETUP` (this switches the login pages off) and retry the deployment.

If the covers stop loading later (e.g. after a password change), `/api/playlist` will report `invalid_grant`: repeat these steps.

## Local preview

```
npx wrangler pages dev . --binding SPOTIFY_CLIENT_ID=... --binding SPOTIFY_CLIENT_SECRET=...
```
