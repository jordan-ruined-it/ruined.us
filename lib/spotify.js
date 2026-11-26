// Shared Spotify helpers for the Pages Functions (imported, not a route).

export const SCOPES = 'playlist-read-private playlist-read-collaborative';

// Setup routes (/api/spotify-login and /callback) only exist while
// SPOTIFY_SETUP is set to "on" in Cloudflare. Remove it after setup.
export function setupEnabled(env) {
  return String(env.SPOTIFY_SETUP || '').toLowerCase() === 'on';
}

export function redirectUri(request) {
  return new URL('/callback', request.url).toString();
}

export function basicAuth(env) {
  return 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
}

export async function tokenRequest(env, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  const res = await fetch('https://accounts.spotify.com/api/token', {
    signal: ctrl.signal,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(env),
    },
    body: new URLSearchParams(params).toString(),
  }).catch((e) => { throw new Error(e.name === 'AbortError' ? 'token timeout after 6s' : e.message); })
    .finally(() => clearTimeout(timer));
  if (!res.ok) {
    const err = new Error(`token ${res.status}: ${await spotifyError(res)}`);
    if (res.status === 429) err.retryAfter = Number(res.headers.get('Retry-After')) || 60;
    throw err;
  }
  return res.json();
}

// Spotify's error message, kept short: e.g. "invalid_client" or "Invalid playlist Id".
export async function spotifyError(res) {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    const e = body.error;
    return String((e && e.message) || body.error_description || e || text).slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

export function notFound() {
  return new Response('Not found', { status: 404 });
}

export function page(title, bodyHtml, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body{margin:0;background:#E6E6E6;color:#2E2E2E;font:15px/1.6 Arial,Helvetica,sans-serif;display:flex;justify-content:center}
  main{max-width:640px;padding:48px 24px}
  h1{font-weight:400;font-size:32px;margin:0 0 16px}
  textarea{width:100%;height:120px;font:13px/1.4 ui-monospace,monospace;padding:12px;box-sizing:border-box;border:1px solid #C2C2C2;background:#EDEDED;color:#2E2E2E}
  code{background:#DCDCDC;padding:1px 5px}
  ol{padding-left:20px}
</style></head><body><main>${bodyHtml}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
