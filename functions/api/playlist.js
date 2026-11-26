// GET /api/playlist            whole playlist + artist list (info page)
// GET /api/playlist?scope=grid  first 13 tracks (home page)
//
// The site keeps the latest playlist it has seen (the "state").
// Requests WITHOUT ?check=1 (clicking around inside the site) are answered from
// the state and never touch Spotify.
// Requests WITH ?check=1 (someone just arrived on the home or info page) ask
// Spotify one cheap question first: "has the playlist changed?" (its snapshot_id).
// Only if it has is the playlist downloaded again and saved as the new state.
// So an arrival costs 1 Spotify call, and a playlist change costs a few more, once.
//
// If Spotify says "too many requests", the site waits as long as Spotify asks
// before calling again, and keeps serving the saved state meanwhile.
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
const MIN_GAP_MS = 60 * 1000;              // no new check within 1 minute of the last one
const STATE_KEEP_SECONDS = 60 * 60 * 24 * 30;

export async function onRequestGet({ request, env }) {
  const grid = new URL(request.url).searchParams.get('scope') === 'grid';
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = (name) => new Request(new URL(`/api/playlist/_${name}`, request.url).toString());
  const store = {
    get: async (name) => { if (!cache) return null; const r = await cache.match(key(name)).catch(() => null); return r ? r.json() : null; },
    put: (name, value, seconds) => cache
      ? cache.put(key(name), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}` } })).catch(() => {})
      : Promise.resolve(),
  };
  const shape = (state, extra = {}) => json({
    tracks: grid ? state.tracks.slice(0, GRID_TRACKS) : state.tracks,
    ...(grid ? {} : { artists: state.artists }),
    updatedAt: state.updatedAt,
    ...extra,
  });

  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    return json({ error: 'Spotify credentials are not configured.' }, 500);
  }

  const wantsCheck = new URL(request.url).searchParams.get('check') === '1';
  const state = await store.get('state');
  if (state) {
    // inside-the-site click, or someone just checked: answer from the saved state
    if (!wantsCheck || Date.now() - (state.checkedAt || 0) < MIN_GAP_MS) return shape(state);
    // fresh arrival: ask Spotify whether it changed; if Spotify is slow or refuses, use the saved state
    try {
      return shape(await refresh(env, store, state));
    } catch (err) {
      console.error('playlist check failed:', err.message);
      return shape(state);
    }
  }

  // nothing saved yet (first visit ever, or the cache was cleared): fetch now
  try {
    const fresh = await refresh(env, store, null);
    return shape(fresh);
  } catch (err) {
    // 503, not 502: on ruined.us Cloudflare replaces a 502 with its own error page and hides the reason
    return json({ error: 'Could not load playlist.', reason: err.message }, 503, { 'Retry-After': '30' });
  }
}

// One background check: is Spotify telling us to wait? has the playlist changed?
let refreshing = null;
async function refresh(env, store, state) {
  if (refreshing) return refreshing;                       // one check at a time per server
  refreshing = (async () => {
    if (await store.get('cooldown')) throw new Error('playlist 429: waiting for Spotify’s rate limit to lift');
    if (state && (await store.get('checking'))) return state; // another server is already checking
    await store.put('checking', 1, 20);
    try {
      const playlistId = env.SPOTIFY_PLAYLIST_ID || DEFAULT_PLAYLIST;
      const token = await getAccessToken(env);
      const snapshot = await getSnapshotId(playlistId, token);           // 1 small call
      if (state && snapshot && snapshot === state.snapshotId) {
        const same = { ...state, checkedAt: Date.now() };
        await store.put('state', same, STATE_KEEP_SECONDS);
        return same;
      }
      const items = await getAllItems(playlistId, token);                // only when it changed
      const next = { ...build(items), snapshotId: snapshot, checkedAt: Date.now(), updatedAt: new Date().toISOString() };
      await store.put('state', next, STATE_KEEP_SECONDS);
      return next;
    } catch (err) {
      memo = { token: null, expires: 0, key: '' };
      if (err.retryAfter) {
        // Spotify said how long to back off: don't call it again until then (capped at a day)
        await store.put('cooldown', 1, Math.min(86400, Math.max(30, err.retryAfter)));
      }
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function build(items) {
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
  return { tracks, artists };
}

async function getSnapshotId(playlistId, token) {
  const res = await fetchWithTimeout(`https://api.spotify.com/v1/playlists/${playlistId}?fields=snapshot_id`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await httpError('playlist', res);
  const body = await res.json();
  return body.snapshot_id || null;
}

async function httpError(what, res) {
  const err = new Error(`${what} ${res.status}: ${await spotifyError(res)}`);
  if (res.status === 429) err.retryAfter = Number(res.headers.get('Retry-After')) || 60;
  return err;
}

function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SPOTIFY_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .catch((e) => { throw new Error(e.name === 'AbortError' ? `timeout after ${SPOTIFY_TIMEOUT_MS / 1000}s` : e.message); })
    .finally(() => clearTimeout(timer));
}

// Spotify's access token lasts an hour. Keep it in memory and reuse it until
// shortly before it expires, so a check is one Spotify call, not two.
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
async function getAllItems(playlistId, token, max = Infinity) { // full playlist: 50 per call
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
    if (!res.ok) throw await httpError('playlist', res);
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
