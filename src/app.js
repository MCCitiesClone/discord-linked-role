import express from 'express';
import cookieParser from 'cookie-parser';

import config from './config.js';
import * as discord from './discord.js';
import * as storage from './storage.js';

const app = express();

app.use(express.json());
app.use(cookieParser(config.COOKIE_SECRET));

app.get('/', (req, res) => {
  res.send('OK');
});

/**
 * Route configured in the Discord developer console which facilitates the
 * connection between Discord and any additional services you may use.
 */
app.get('/linked-role', async (req, res) => {
  try {
    const redirectUri = getRedirectUri(req);
    const { url, state } = discord.getOAuthUrl(redirectUri);

    res.cookie('clientState', state, {
      httpOnly: true,
      maxAge: 1000 * 60 * 5,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      signed: true,
    });

    res.redirect(url);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

/**
 * Route configured in the Discord developer console as the OAuth2 redirect URL.
 */
app.get('/discord-oauth-callback', async (req, res) => {
  try {
    const redirectUri = getRedirectUri(req);
    const code = req.query.code;
    const discordState = req.query.state;

    const { clientState } = req.signedCookies;
    if (!clientState || clientState !== discordState) {
      console.error('State verification failed.');
      return res.sendStatus(403);
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

    res.send('You did it! Now go back to Discord.');
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

/**
 * Example route that would be invoked when an external data source changes.
 */
app.post('/update-metadata', async (req, res) => {
  try {
    const { userId } = req.body ?? {};
    if (!userId) {
      return res.status(400).send('Missing userId');
    }

    await updateMetadata(userId);
    res.sendStatus(204);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

async function updateMetadata(userId) {
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

function getRedirectUri(req) {
  if (config.DISCORD_REDIRECT_URI) {
    return config.DISCORD_REDIRECT_URI;
  }

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.protocol;
  const host = req.get('host');

  if (!host) {
    throw new Error('Unable to build Discord redirect URI: request host is missing.');
  }

  const redirectUri = `${proto}://${host}/discord-oauth-callback`;
  console.warn(`DISCORD_REDIRECT_URI is not set; using request-derived redirect URI: ${redirectUri}`);
  return redirectUri;
}

export { updateMetadata };
export default app;
