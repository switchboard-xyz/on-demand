import TTLCache from '@isaacs/ttlcache';

/**
 *  Cache for gateway ping responses.
 *
 *  A value of true means that the gateway is healthy.
 */
export const GATEWAY_PING_CACHE = new TTLCache<string, boolean>({
  ttl: 1000 * 60,
});
