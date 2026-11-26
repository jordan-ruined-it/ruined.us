// GET /callback
// Spotify sends you back here after /api/spotify-login. Shows the refresh
// token once so you can save it in Cloudflare as SPOTIFY_REFRESH_TOKEN.
// Only works while SPOTIFY_SETUP=on is set in Cloudflare.
import { setupEnabled, redirectUri, tokenRequest, notFound, page, escapeHtml } from '../lib/spotify.js';

export async function onRequestGet({ request, env }) {
  if (!setupEnabled(env)) return notFound();

  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return page('Spotify login cancelled', `<h1>login didn't finish</h1><p>Spotify said: <code>${escapeHtml(error)}</code>. <a href="/api/spotify-login">Try again</a>.</p>`, 400);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)spotify_state=([^;]+)/);
  if (!code || !state || !cookie || cookie[1] !== state) {
    return page('Spotify setup', `<h1>link expired</h1><p>Start again from <a href="/api/spotify-login">/api/spotify-login</a>.</p>`, 400);
  }

  let tokens;
  try {
    tokens = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(request),
    });
  } catch (err) {
    return page('Spotify setup', `<h1>Spotify refused the login</h1><p><code>${escapeHtml(err.message)}</code></p>`, 502);
  }

  // Check the playlist is readable with this login before handing the token over.
  let check = '';
  try {
    const playlistId = env.SPOTIFY_PLAYLIST_ID || '2USDDnrlxhw82ydTl5TfbN';
    const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items?limit=1`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    check = res.ok
      ? '<p>✓ This login can read the portfolio playlist.</p>'
      : `<p><strong>Heads up:</strong> this login still can't read the playlist (Spotify said ${res.status}). Make sure you logged in with the account that owns it.</p>`;
  } catch {
    check = '';
  }

  const body = `
<h1>almost done</h1>
${check}
<p>Copy this refresh token:</p>
<textarea readonly onclick="this.select()">${escapeHtml(tokens.refresh_token || '')}</textarea>
<ol>
  <li>Cloudflare → ruined-us → Settings → Variables and Secrets (Production): add <code>SPOTIFY_REFRESH_TOKEN</code> as a <strong>Secret</strong> with this value.</li>
  <li>Delete the <code>SPOTIFY_SETUP</code> variable, so this page and the login link switch off.</li>
  <li>Deployments → latest → ⋯ → Retry deployment.</li>
</ol>
<p>Don't share this token; it lets the site read your Spotify playlists.</p>`;
  return page('Spotify setup', body);
}
