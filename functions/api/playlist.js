// GET /api/playlist
// Fetches the portfolio playlist from Spotify on the server, so the Spotify
// client secret never reaches the browser. Responses are cached at the edge.
//
// Required environment variables (Cloudflare Pages → Settings → Variables and Secrets):
//   SPOTIFY_CLIENT_ID      (plain text or secret)
//   SPOTIFY_CLIENT_SECRET  (secret)
// Optional:
//   SPOTIFY_PLAYLIST_ID    (defaults to the portfolio playlist below)

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
    const token = await getToken(env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET);
    const items = await getAllItems(env.SPOTIFY_PLAYLIST_ID || DEFAULT_PLAYLIST, token);

    const tracks = items
      .map((item) => item && item.track)
      .filter((t) => t && t.id)
      .map((t) => ({
        artist: (t.artists && t.artists[0] && t.artists[0].name) || 'Unknown Artist',
        title: t.name || 'Unknown Track',
        url: (t.external_urls && t.external_urls.spotify) || `https://open.spotify.com/track/${t.id}`,
        image: pickImage(t.album && t.album.images),
      }));

    const artists = [...new Set(items.flatMap((item) => (item && item.track && item.track.artists || []).map((a) => a.name)))]
      .filter((name) => name && !HIDDEN_ARTISTS.has(name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const response = json({ tracks, artists }, 200, {
      'Cache-Control': `public, max-age=600, s-maxage=${CACHE_SECONDS}`,
    });
    waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    // The reason is Spotify's own error text (e.g. "token 400: invalid_client"); it never contains the keys.
    console.error('playlist failed:', err.message);
    return json({ error: 'Could not load playlist.', reason: err.message }, 502);
  }
}

async function getToken(id, secret) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${id}:${secret}`),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await spotifyError(res)}`);
  const data = await res.json();
  return data.access_token;
}

async function getAllItems(playlistId, token) {
  const fields = 'items(track(id,name,external_urls,artists(name),album(images))),next';
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;
  const items = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`playlist ${res.status}: ${await spotifyError(res)}`);
    const page = await res.json();
    items.push(...(page.items || []));
    url = page.next;
  }
  return items;
}

// Spotify's error message, kept short: e.g. "invalid_client" or "Invalid playlist Id".
async function spotifyError(res) {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    const e = body.error;
    return String((e && e.message) || body.error_description || e || text).slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
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
