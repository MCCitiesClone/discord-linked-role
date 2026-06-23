import { Redis } from '@upstash/redis';

export type DiscordTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at: number;
};

const localStore = new Map<string, DiscordTokens>();

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

function keyForUser(userId: string) {
  return `discord-${userId}`;
}

export async function storeDiscordTokens(userId: string, tokens: DiscordTokens) {
  const key = keyForUser(userId);

  if (!redis) {
    localStore.set(key, tokens);
    return;
  }

  await redis.set(key, tokens);
}

export async function getDiscordTokens(userId: string) {
  const key = keyForUser(userId);

  if (!redis) {
    return localStore.get(key);
  }

  return redis.get<DiscordTokens>(key);
}
