import { Hono } from 'hono';
import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';

import config from './config.js';
import * as discord from './discord.js';
import * as storage from './storage.js';

const app = new Hono();

app.get('/', (c) => c.text('OK'));

/**
 * Route configured in the Discord developer console which facilitates the
 * connection between Discord and any additional services you may use.
 */
app.get('/linked-role', async (c) => {
  try {
    const redirectUri = getRedirectUri(c);
    const { url, state } = discord.getOAuthUrl(redirectUri);

    await setSignedCookie(c, 'clientState', state, config.COOKIE_SECRET ?? '', {
      httpOnly: true,
      maxAge: 60 * 5,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return c.redirect(url);
  } catch (e) {
    console.error(e);
    return c.text('Internal Server Error', 500);
  }
});

/**
 * Route configured in the Discord developer console as the OAuth2 redirect URL.
 */
app.get('/discord-oauth-callback', async (c) => {
  try {
    const redirectUri = getRedirectUri(c);
    const code = c.req.query('code');
    const discordState = c.req.query('state');

    const clientState = await getSignedCookie(c, config.COOKIE_SECRET ?? '', 'clientState');
    if (!clientState || clientState !== discordState) {
      console.error('State verification failed.');
      return c.text('Forbidden', 403);
    }

    const tokens = await discord.getOAuthTokens(code, redirectUri);
    const meData = await discord.getUserData(tokens);
    const userId = meData.user.id;

    await storage.storeDiscordTokens(userId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });

    await updateMetadata(userId);

    return c.text('You did it! Now go back to Discord.');
  } catch (e) {
    console.error(e);
    return c.text('Internal Server Error', 500);
  }
});

/**
 * Example route that would be invoked when an external data source changes.
 */
app.post('/update-metadata', async (c) => {
  try {
    const { userId } = await c.req.json<{ userId?: string }>().catch((): { userId?: string } => ({}));
    if (!userId) {
      return c.text('Missing userId', 400);
    }

    await updateMetadata(userId);
    return c.body(null, 204);
  } catch (e) {
    console.error(e);
    return c.text('Internal Server Error', 500);
  }
});

async function updateMetadata(userId: string) {
  const tokens = await storage.getDiscordTokens(userId);
  if (!tokens) {
    throw new Error(`No stored Discord tokens for user ${userId}`);
  }

  const metadata = {
    cookieseaten: 1483,
    allergictonuts: 0,
    bakingsince: '2003-12-20',
  };

  await discord.pushMetadata(userId, tokens, metadata);
}

function getRedirectUri(c: Context) {
  if (config.DISCORD_REDIRECT_URI) {
    return config.DISCORD_REDIRECT_URI;
  }

  const requestUrl = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || requestUrl.protocol.replace(':', '');
  const host = c.req.header('host');

  if (!host) {
    throw new Error('Unable to build Discord redirect URI: request host is missing.');
  }

  const redirectUri = `${proto}://${host}/discord-oauth-callback`;
  console.warn(`DISCORD_REDIRECT_URI is not set; using request-derived redirect URI: ${redirectUri}`);
  return redirectUri;
}

export { updateMetadata };
export default app;
