// GET /api/spotify-login
// One-time setup: sends you to Spotify to log in as the playlist owner.
// Only works while SPOTIFY_SETUP=on is set in Cloudflare.
import { SCOPES, setupEnabled, redirectUri, notFound } from '../../lib/spotify.js';

export async function onRequestGet({ request, env }) {
  if (!setupEnabled(env) || !env.SPOTIFY_CLIENT_ID) return notFound();

  const state = crypto.randomUUID();
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(request),
    scope: SCOPES,
    state,
    show_dialog: 'true',
  }).toString();

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': `spotify_state=${state}; Path=/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    },
  });
}
