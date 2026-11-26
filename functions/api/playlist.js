// GET /api/playlist
// Reads the portfolio playlist from Spotify on the server, so no Spotify keys
// reach the browser. Responses are cached at the edge.
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
const CACHE_SECONDS = 60 * 60 * 6; // 6 hours
const HIDDEN_ARTISTS = new Set(['jordan_ruined_it']);

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/playlist', request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    return json({ error: 'Spotify credentials are not configured.' }, 500);
  }

  try {
    const token = await getAccessToken(env);
    const items = await getAllItems(env.SPOTIFY_PLAYLIST_ID || DEFAULT_PLAYLIST, token);

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

    const response = json({ tracks, artists }, 200, {
      'Cache-Control': `public, max-age=600, s-maxage=${CACHE_SECONDS}`,
    });
    waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    // The reason is Spotify's own error text (e.g. "token 400: invalid_grant"); it never contains the keys.
    console.error('playlist failed:', err.message);
    return json({ error: 'Could not load playlist.', reason: err.message }, 502);
  }
}

// As the playlist owner when a refresh token is set; otherwise as the app,
// which Spotify only allows for older apps.
async function getAccessToken(env) {
  const data = env.SPOTIFY_REFRESH_TOKEN
    ? await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN })
    : await tokenRequest(env, { grant_type: 'client_credentials' });
  if (data.refresh_token && env.SPOTIFY_REFRESH_TOKEN && data.refresh_token !== env.SPOTIFY_REFRESH_TOKEN) {
    console.warn('Spotify issued a new refresh token; the stored one may stop working. Redo /api/spotify-login if so.');
  }
  return data.access_token;
}

// Spotify renamed the playlist endpoint in Feb 2026 (/tracks → /items, track → item).
// Try the new one first; fall back to the old one for apps that still have it.
async function getAllItems(playlistId, token) {
  try {
    return await pageThrough(
      `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50`,
      token,
      (entry) => entry && (entry.item || entry.track),
    );
  } catch (err) {
    try {
      return await pageThrough(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`,
        token,
        (entry) => entry && entry.track,
      );
    } catch {
      throw err; // report the /items error, which is the current endpoint
    }
  }
}

async function pageThrough(url, token, pick) {
  const out = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`playlist ${res.status}: ${await spotifyError(res)}`);
    const page = await res.json();
    for (const entry of page.items || []) {
      const track = pick(entry);
      if (track) out.push({ track });
    }
    url = page.next;
  }
  return out;
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
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}
