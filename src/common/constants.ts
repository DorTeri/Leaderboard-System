export const CORRELATION_ID_HEADER = 'x-correlation-id';

export const TOP_CACHE_KEY_PREFIX = 'leaderboard:top:';

export const DEFAULT_CACHE_INVALIDATION_LIMITS = [100, 1000];

export const NODE_ENV_DEVELOPMENT = 'development';

export function topCacheKey(limit: number): string {
  return `${TOP_CACHE_KEY_PREFIX}${limit}`;
}

