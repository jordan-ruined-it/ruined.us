// GET /api/playlist            whole playlist + artist list (info page)
// GET /api/playlist?scope=grid  first 13 tracks only (home page): one Spotify call, fast
// Reads the playlist from Spotify on the server, so no Spotify keys reach the browser.
// Visitors share one Spotify call per minute, so playlist changes show within a
// minute without flooding Spotify. If Spotify says "too many requests", the site
// waits as long as Spotify asks before calling again. If Spotify fails or is slow,
// the last good answer is served instead (marked "stale": true).
//
// Cloudflare Pages → Settings → Variables and Secrets:
//   SPOTIFY_CLIENT_ID       required
//   SPOTIFY_CLIENT_SECRET   required (secret)
//   SPOTIFY_REFRESH_TOKEN   required since Spotify's Feb 2026 rules (secret):
//                           lets the site read the playlist as its owner.
//                           Get it once via /api/spotify-login (see README).
//   SPOTIFY_PLAYLIST_ID     optional, defaults to the portfolio playlist
import { tokenRequest, spotifyError } from '../../lib/spotify.js';

const DEFAULT_PLAYLIST = '2USDDnrlxhw82ydTl5TfbN';
const HIDDEN_ARTISTS = new Set(['jordan_ruined_it']);
const GRID_TRACKS = 13;
const SPOTIFY_TIMEOUT_MS = 6000;
const SHARED_SECONDS = 60;   // all visitors within the same minute share one Spotify call

export async function onRequestGet({ request, env, waitUntil }) {
  const scope = new URL(request.url).searchParams.get('scope') === 'grid' ? 'grid' : 'all';
  const lastGoodKey = new Request(new URL(`/api/playlist/last-good?scope=${scope}`, request.url).toString());
  const cache = typeof caches !== 'undefined' ? caches.default : null;

  const freshKey = new Request(new URL(`/api/playlist/fresh?scope=${scope}`, request.url).toString());
  const coolKey = new Request(new URL('/api/playlist/cooldown', request.url).toString());

  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    return json({ error: 'Spotify credentials are not configured.' }, 500);
  }

  if (cache) {
    // someone already asked Spotify in the last minute: reuse that answer
    const fresh = await cache.match(freshKey).catch(() => null);
    if (fresh) return json(await fresh.json());
  }

  try {
    if (cache && (await cache.match(coolKey).catch(() => null))) {
      throw new Error('playlist 429: waiting for Spotify’s rate limit to lift');
    }
    const token = await getAccessToken(env);
    const items = await getAllItems(env.SPOTIFY_PLAYLIST_ID || DEFAULT_PLAYLIST, token, scope === 'grid' ? GRID_TRACKS : Infinity);

    const tracks = items
      .map((item) => item.track)
      .filter((t) => t && t.id)
      .map((t) => ({
        artist: (t.artists && t.artists[0] && t.artists[0].name) || 'Unknown Artist',
        title: t.name || 'Unknown Track',
        url: (t.external_urls && t.external_urls.spotify) || `https://open.spotify.com/track/${t.id}`,
        image: pickImage(t.album && t.album.images),
      }));

    const artists = [...new Set(items.flatMap((item) => (item.track && item.track.artists || []).map((a) => a.name)))]
      .filter((name) => name && !HIDDEN_ARTISTS.has(name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const body = scope === 'grid' ? { tracks } : { tracks, artists };
    if (cache) {
      // remember this answer for a week, to fall back on if Spotify has a bad moment
      const keep = json(body, 200, { 'Cache-Control': 'public, max-age=604800' });
      const share = json(body, 200, { 'Cache-Control': `public, max-age=${SHARED_SECONDS}` });
      waitUntil(Promise.all([cache.put(lastGoodKey, keep), cache.put(freshKey, share)]).catch(() => {}));
    }
    return json(body);
  } catch (err) {
    // The reason is Spotify's own error text (e.g. "playlist 429: API rate limit exceeded"); it never contains the keys.
    console.error('playlist failed:', err.message);
    memo = { token: null, expires: 0, key: '' }; // get a fresh login next time
    if (cache && err.retryAfter) {
      // Spotify said how long to back off: don't call it again until then (capped at a day)
      const secs = Math.min(86400, Math.max(30, err.retryAfter));
      waitUntil(cache.put(coolKey, new Response('cooling down', { headers: { 'Cache-Control': `public, max-age=${secs}` } })).catch(() => {}));
    }
    const last = cache ? await cache.match(lastGoodKey).catch(() => null) : null;
    if (last) {
      const body = await last.json();
      return json({ ...body, stale: true, reason: err.message });
    }
    // 503, not 502: on ruined.us Cloudflare replaces a 502 with its own error page and hides the reason
    return json({ error: 'Could not load playlist.', reason: err.message }, 503, { 'Retry-After': '30' });
  }
}

function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SPOTIFY_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .catch((e) => { throw new Error(e.name === 'AbortError' ? `timeout after ${SPOTIFY_TIMEOUT_MS / 1000}s` : e.message); })
    .finally(() => clearTimeout(timer));
}

// Spotify's access token lasts an hour. Keep it in memory and reuse it until
// shortly before it expires, so each visit is one Spotify call, not two.
// (Only the login is reused; the playlist itself is always fetched fresh.)
let memo = { token: null, expires: 0, key: '' };

// As the playlist owner when a refresh token is set; otherwise as the app,
// which Spotify only allows for older apps.
async function getAccessToken(env) {
  const key = `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_REFRESH_TOKEN || ''}`;
  if (memo.token && memo.key === key && Date.now() < memo.expires) return memo.token;

  const data = env.SPOTIFY_REFRESH_TOKEN
    ? await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN })
    : await tokenRequest(env, { grant_type: 'client_credentials' });
  if (data.refresh_token && env.SPOTIFY_REFRESH_TOKEN && data.refresh_token !== env.SPOTIFY_REFRESH_TOKEN) {
    console.warn('Spotify issued a new refresh token; the stored one may stop working. Redo /api/spotify-login if so.');
  }
  const lifetime = Number(data.expires_in) || 3600;
  memo = { token: data.access_token, expires: Date.now() + (lifetime - 300) * 1000, key };
  return data.access_token;
}

// Spotify renamed the playlist endpoint in Feb 2026 (/tracks → /items, track → item).
// Try the new one first; fall back to the old one for apps that still have it.
async function getAllItems(playlistId, token, max = Infinity) {
  try {
    return await pageThrough(
      `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${Math.min(50, max)}`,
      token,
      (entry) => entry && (entry.item || entry.track),
      max,
    );
  } catch (err) {
    if (/^timeout/.test(err.message) || err.retryAfter) throw err; // slow or rate-limited: don't make a second call
    try {
      return await pageThrough(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${Math.min(100, max)}`,
        token,
        (entry) => entry && entry.track,
        max,
      );
    } catch {
      throw err; // report the /items error, which is the current endpoint
    }
  }
}

async function pageThrough(url, token, pick, max = Infinity) {
  const out = [];
  while (url && out.length < max) {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const err = new Error(`playlist ${res.status}: ${await spotifyError(res)}`);
      if (res.status === 429) err.retryAfter = Number(res.headers.get('Retry-After')) || 60;
      throw err;
    }
    const page = await res.json();
    for (const entry of page.items || []) {
      const track = pick(entry);
      if (track) out.push({ track });
    }
    url = page.next;
  }
  return out.slice(0, max);
}

// Prefer the ~640px cover; fall back to whatever is there.
function pickImage(images) {
  if (!images || !images.length) return null;
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  return (sorted.find((i) => (i.width || 0) <= 640) || sorted[0]).url;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
