# ruined.us

Landing page for jordan ruined it — mixing, mastering, production. Static HTML/CSS on Cloudflare Pages, plus one Pages Function that loads the Spotify portfolio playlist server-side.

```
index.html              home: hero, work grid, contact
info.html               services, how to send files, artist list  (served at /info)
assets/style.css        all styles (light grayscale palette in :root)
assets/site.js          swaps the static work grid / artist list for live Spotify data
assets/RiverSHINE.ttf   display font
assets/favicon.svg
assets/studio.jpg       studio photo for /info  (add this file)
functions/api/playlist.js   GET /api/playlist → { tracks, artists }, cached 6h at the edge
_headers                cache + security headers
```

The pages work without JavaScript or the API: they ship a static copy of the work grid and artist list, and `site.js` replaces them with the live playlist (with cover art) when `/api/playlist` responds.

## Deploy (Cloudflare Pages)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Build settings: framework preset **None**, build command **empty**, output directory **`/`**.
3. Settings → Variables and Secrets (Production and Preview):
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET` (type: Secret)
   - optional `SPOTIFY_PLAYLIST_ID` (defaults to `2USDDnrlxhw82ydTl5TfbN`)
4. Custom domains → add `ruined.us` (and `www.ruined.us` if wanted). Because the zone is already on this Cloudflare account, the DNS records are created for you — delete any old A/AAAA/CNAME records on `ruined.us` first.

Every push to `main` redeploys.

## Local preview

```
npx wrangler pages dev . --binding SPOTIFY_CLIENT_ID=... --binding SPOTIFY_CLIENT_SECRET=...
```
