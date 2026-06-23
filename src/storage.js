import { Redis } from '@upstash/redis';

const localStore = new Map();

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

function keyForUser(userId) {
  return `discord-${userId}`;
}

export async function storeDiscordTokens(userId, tokens) {
  const key = keyForUser(userId);

  if (!redis) {
    localStore.set(key, tokens);
    return;
  }

  await redis.set(key, tokens);
}

export async function getDiscordTokens(userId) {
  const key = keyForUser(userId);

  if (!redis) {
    return localStore.get(key);
  }

  return redis.get(key);
}
