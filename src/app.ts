import { Hono } from 'hono';
import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';

import config from './config.js';
import * as discord from './discord.js';
import * as storage from './storage.js';

const app = new Hono();

app.get('/', (c) => c.text('OK'));

app.get('/admin/metadata-schema', (c) => {
  const status = config.REGISTER_ADMIN_SECRET ? 200 : 503;
  return c.html(renderMetadataSchemaPage(config.REGISTER_ADMIN_SECRET
    ? {}
    : { error: 'REGISTER_ADMIN_SECRET is not configured.' }), status);
});

app.post('/admin/metadata-schema', async (c) => {
  const requestId = getRequestId(c);
  const startedAt = Date.now();

  console.info(`[${requestId}] Metadata schema registration form submitted`, {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    userAgent: c.req.header('user-agent'),
    hasAdminSecretConfigured: Boolean(config.REGISTER_ADMIN_SECRET),
  });

  try {
    if (!config.REGISTER_ADMIN_SECRET) {
      console.error(`[${requestId}] Metadata schema registration blocked: REGISTER_ADMIN_SECRET is not configured`);
      return c.html(renderMetadataSchemaPage({
        error: 'REGISTER_ADMIN_SECRET is not configured.',
      }), 503);
    }

    console.info(`[${requestId}] Parsing metadata schema registration form body`);
    const body = await c.req.parseBody();
    const adminSecret = body.adminSecret;

    if (typeof adminSecret !== 'string' || adminSecret !== config.REGISTER_ADMIN_SECRET) {
      console.warn(`[${requestId}] Metadata schema registration rejected: invalid admin key`, {
        adminSecretType: typeof adminSecret,
        elapsedMs: Date.now() - startedAt,
      });
      return c.html(renderMetadataSchemaPage({
        error: 'Invalid admin key.',
      }), 403);
    }

    console.info(`[${requestId}] Admin key accepted; calling Discord metadata schema API`);
    const result = await discord.registerMetadataSchema({ requestId });
    console.info(`[${requestId}] Metadata schema registration page completed`, {
      elapsedMs: Date.now() - startedAt,
    });

    return c.html(renderMetadataSchemaPage({
      result,
      success: 'Metadata schema registered with Discord.',
    }));
  } catch (e) {
    console.error(`[${requestId}] Metadata schema registration page failed`, {
      elapsedMs: Date.now() - startedAt,
      error: formatUnknownError(e),
    });
    return c.html(renderMetadataSchemaPage({
      error: e instanceof Error ? e.message : 'Internal Server Error',
    }), 500);
  }
});

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

function getRequestId(c: Context) {
  return c.req.header('x-vercel-id')
    ?? c.req.header('x-request-id')
    ?? `schema-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderMetadataSchemaPage(options: {
  error?: string;
  result?: unknown;
  success?: string;
} = {}) {
  const schemaRows = discord.metadataSchema.map((record) => `
        <tr>
          <td>${escapeHtml(record.key)}</td>
          <td>${escapeHtml(record.name)}</td>
          <td>${escapeHtml(record.description)}</td>
          <td>${record.type}</td>
        </tr>
  `).join('');
  const resultJson = options.result
    ? JSON.stringify(options.result, null, 2)
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Register Discord Metadata Schema</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
      }

      body {
        margin: 0;
        background: #f6f7f9;
        color: #1f2328;
      }

      main {
        max-width: 880px;
        margin: 0 auto;
        padding: 48px 20px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(1.8rem, 4vw, 2.5rem);
        line-height: 1.1;
      }

      p {
        margin: 0 0 24px;
        color: #59636e;
      }

      section {
        margin-top: 28px;
      }

      form {
        display: grid;
        gap: 12px;
        max-width: 420px;
      }

      label {
        font-weight: 650;
      }

      input {
        min-height: 42px;
        border: 1px solid #c9d1d9;
        border-radius: 6px;
        padding: 0 12px;
        font: inherit;
      }

      button {
        min-height: 42px;
        border: 0;
        border-radius: 6px;
        background: #5865f2;
        color: white;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }

      button:focus,
      input:focus {
        outline: 3px solid #99a2ff;
        outline-offset: 2px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: white;
      }

      th,
      td {
        border-bottom: 1px solid #d8dee4;
        padding: 10px 12px;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: #59636e;
        font-size: 0.9rem;
      }

      .notice {
        border-radius: 6px;
        margin: 0 0 18px;
        padding: 12px 14px;
      }

      .error {
        background: #ffebe9;
        color: #82071e;
      }

      .success {
        background: #dafbe1;
        color: #116329;
      }

      pre {
        overflow: auto;
        border-radius: 6px;
        background: #24292f;
        color: #f6f8fa;
        padding: 14px;
      }

      @media (prefers-color-scheme: dark) {
        body {
          background: #0d1117;
          color: #f0f6fc;
        }

        p,
        th {
          color: #8b949e;
        }

        table {
          background: #161b22;
        }

        th,
        td {
          border-color: #30363d;
        }

        input {
          background: #0d1117;
          border-color: #30363d;
          color: #f0f6fc;
        }

        .error {
          background: #490202;
          color: #ffdcd7;
        }

        .success {
          background: #033a16;
          color: #acf2bd;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Register Discord Metadata Schema</h1>
      <p>Push the configured linked role metadata fields to Discord.</p>

      ${options.error ? `<div class="notice error">${escapeHtml(options.error)}</div>` : ''}
      ${options.success ? `<div class="notice success">${escapeHtml(options.success)}</div>` : ''}

      <form method="post" action="/admin/metadata-schema">
        <label for="adminSecret">Admin key</label>
        <input id="adminSecret" name="adminSecret" type="password" autocomplete="current-password" required>
        <button type="submit">Register schema</button>
      </form>

      <section>
        <h2>Schema</h2>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Name</th>
              <th>Description</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            ${schemaRows}
          </tbody>
        </table>
      </section>

      ${resultJson ? `<section><h2>Discord response</h2><pre>${escapeHtml(resultJson)}</pre></section>` : ''}
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

export { updateMetadata };
export default app;
