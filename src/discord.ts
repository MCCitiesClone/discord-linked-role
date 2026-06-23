import crypto from 'crypto';

import * as storage from './storage.js';
import type { DiscordTokens } from './storage.js';
import config from './config.js';

/**
 * Code specific to communicating with the Discord API.
 */

/**
 * The following methods all facilitate OAuth2 communication with Discord.
 * See https://discord.com/developers/docs/topics/oauth2 for more details.
 */

/**
 * Generate the url which the user will be directed to in order to approve the
 * bot, and see the list of requested scopes.
 */
type OAuthTokensResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type DiscordUserData = {
  user: {
    id: string;
  };
};

type Metadata = {
  cookieseaten: number;
  allergictonuts: number;
  bakingsince: string;
};

type MetadataSchemaRecord = {
  key: string;
  name: string;
  description: string;
  type: number;
};

type RegisterMetadataSchemaOptions = {
  requestId?: string;
  timeoutMs?: number;
};

const defaultDiscordRequestTimeoutMs = 8_000;

export const metadataSchema: MetadataSchemaRecord[] = [
  {
    key: 'cookieseaten',
    name: 'Cookies Eaten',
    description: 'Cookies Eaten Greater Than',
    type: 2,
  },
  {
    key: 'allergictonuts',
    name: 'Allergic To Nuts',
    description: 'Is Allergic To Nuts',
    type: 7,
  },
  {
    key: 'bakingsince',
    name: 'Baking Since',
    description: 'Days since baking their first cookie',
    type: 6,
  },
];

/**
 * Register the metadata schema that guild admins can use in linked role rules.
 * This uses the bot token and should only be exposed to trusted operators.
 */
export async function registerMetadataSchema(options: RegisterMetadataSchemaOptions = {}) {
  const requestId = options.requestId ?? 'register-schema';
  const timeoutMs = options.timeoutMs ?? defaultDiscordRequestTimeoutMs;
  const startedAt = Date.now();
  const missing: string[] = [];

  if (!config.DISCORD_CLIENT_ID) {
    missing.push('DISCORD_CLIENT_ID');
  }
  if (!config.DISCORD_TOKEN) {
    missing.push('DISCORD_TOKEN');
  }

  if (missing.length > 0) {
    console.error(`[${requestId}] Discord metadata schema registration configuration is incomplete`, {
      missing,
    });
    throw new Error(`Missing required Discord registration configuration: ${missing.join(', ')}`);
  }

  const url = `https://discord.com/api/v10/applications/${config.DISCORD_CLIENT_ID}/role-connections/metadata`;
  const payload = JSON.stringify(metadataSchema);

  console.info(`[${requestId}] Registering Discord metadata schema`, {
    applicationId: config.DISCORD_CLIENT_ID,
    schemaKeys: metadataSchema.map((record) => record.key),
    timeoutMs,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      body: payload,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${config.DISCORD_TOKEN}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error(`[${requestId}] Discord metadata schema request failed before receiving a response`, {
      elapsedMs,
      error: formatUnknownError(error),
    });

    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Timed out registering Discord metadata schema after ${timeoutMs}ms`);
    }

    throw error;
  }

  const elapsedMs = Date.now() - startedAt;
  console.info(`[${requestId}] Discord metadata schema response received`, {
    elapsedMs,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[${requestId}] Discord metadata schema registration was rejected`, {
      elapsedMs,
      status: response.status,
      statusText: response.statusText,
      responseBodyLength: body.length,
      responseBody: body,
    });
    throw new Error(`Error pushing discord metadata schema: [${response.status}] ${response.statusText}: ${body}`);
  }

  const data = await response.json();
  console.info(`[${requestId}] Discord metadata schema registration completed`, {
    elapsedMs: Date.now() - startedAt,
  });
  return data;
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

export function getOAuthUrl(redirectUri = config.DISCORD_REDIRECT_URI) {
  const oauthConfig = getOAuthConfig(redirectUri);

  const state = crypto.randomUUID();

  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', oauthConfig.clientId);
  url.searchParams.set('redirect_uri', oauthConfig.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'role_connections.write identify');
  url.searchParams.set('prompt', 'consent');
  return { state, url: url.toString() };
}

/**
 * Given an OAuth2 code from the scope approval page, make a request to Discord's
 * OAuth2 service to retrieve an access token, refresh token, and expiration.
 */
export async function getOAuthTokens(code: string | undefined, redirectUri = config.DISCORD_REDIRECT_URI) {
  if (!code) {
    throw new Error('Missing Discord OAuth code.');
  }

  const oauthConfig = getOAuthConfig(redirectUri);

  const url = 'https://discord.com/api/v10/oauth2/token';
  const body = new URLSearchParams({
    client_id: oauthConfig.clientId,
    client_secret: oauthConfig.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthConfig.redirectUri,
  });

  const response = await fetch(url, {
    body,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  if (response.ok) {
    const data = await response.json() as OAuthTokensResponse;
    return data;
  } else {
    throw new Error(`Error fetching OAuth tokens: [${response.status}] ${response.statusText}`);
  }
}

function getOAuthConfig(redirectUri: string | undefined) {
  const clientCredentials = getClientCredentials();
  const missing: string[] = [];

  if (!redirectUri) {
    missing.push('DISCORD_REDIRECT_URI');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required Discord OAuth configuration: ${missing.join(', ')}`);
  }

  const verifiedRedirectUri = redirectUri as string;

  return {
    ...clientCredentials,
    redirectUri: verifiedRedirectUri,
  };
}

function getClientCredentials() {
  const missing: string[] = [];

  if (!config.DISCORD_CLIENT_ID) {
    missing.push('DISCORD_CLIENT_ID');
  }
  if (!config.DISCORD_CLIENT_SECRET) {
    missing.push('DISCORD_CLIENT_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required Discord OAuth configuration: ${missing.join(', ')}`);
  }

  return {
    clientId: config.DISCORD_CLIENT_ID,
    clientSecret: config.DISCORD_CLIENT_SECRET,
  } as {
    clientId: string;
    clientSecret: string;
  };
}

/**
 * The initial token request comes with both an access token and a refresh
 * token.  Check if the access token has expired, and if it has, use the
 * refresh token to acquire a new, fresh access token.
 */
export async function getAccessToken(userId: string, tokens: DiscordTokens) {
  if (Date.now() > tokens.expires_at) {
    const clientCredentials = getClientCredentials();
    const url = 'https://discord.com/api/v10/oauth2/token';
    const body = new URLSearchParams({
      client_id: clientCredentials.clientId,
      client_secret: clientCredentials.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    });
    const response = await fetch(url, {
      body,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    if (response.ok) {
      const tokens = await response.json() as OAuthTokensResponse & { expires_at: number };
      tokens.expires_at = Date.now() + tokens.expires_in * 1000;
      await storage.storeDiscordTokens(userId, tokens);
      return tokens.access_token;
    } else {
      throw new Error(`Error refreshing access token: [${response.status}] ${response.statusText}`);
    }
  }
  return tokens.access_token;
}

/**
 * Given a user based access token, fetch profile information for the current user.
 */
export async function getUserData(tokens: OAuthTokensResponse) {
  const url = 'https://discord.com/api/v10/oauth2/@me';
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  });
  if (response.ok) {
    const data = await response.json() as DiscordUserData;
    return data;
  } else {
    throw new Error(`Error fetching user data: [${response.status}] ${response.statusText}`);
  }
}

/**
 * Given metadata that matches the schema, push that data to Discord on behalf
 * of the current user.
 */
export async function pushMetadata(userId: string, tokens: DiscordTokens, metadata: Metadata) {
  // PUT /users/@me/applications/:id/role-connection
  const url = `https://discord.com/api/v10/users/@me/applications/${config.DISCORD_CLIENT_ID}/role-connection`;
  const accessToken = await getAccessToken(userId, tokens);
  const body = {
    platform_name: 'Example Linked Role Discord Bot',
    metadata,
  };
  const response = await fetch(url, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Error pushing discord metadata: [${response.status}] ${response.statusText}`);
  }
}

/**
 * Fetch the metadata currently pushed to Discord for the currently logged
 * in user, for this specific bot.
 */
export async function getMetadata(userId: string, tokens: DiscordTokens) {
  // GET /users/@me/applications/:id/role-connection
  const url = `https://discord.com/api/v10/users/@me/applications/${config.DISCORD_CLIENT_ID}/role-connection`;
  const accessToken = await getAccessToken(userId, tokens);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (response.ok) {
    const data = await response.json();
    return data;
  } else {
    throw new Error(`Error getting discord metadata: [${response.status}] ${response.statusText}`);
  }
}
