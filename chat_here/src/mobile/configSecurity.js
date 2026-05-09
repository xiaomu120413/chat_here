export const DEFAULT_MOBILE_CONFIG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function withMobileConfigSavedAt(config, now = Date.now()) {
  return {
    baseUrl: config?.baseUrl ?? "",
    token: config?.token ?? "",
    savedAt: new Date(now).toISOString(),
  };
}

export function isFreshMobileGatewayConfig(config, now = Date.now(), ttlMs = DEFAULT_MOBILE_CONFIG_TTL_MS) {
  if (!config?.token || !config?.savedAt) {
    return false;
  }
  const savedAt = new Date(config.savedAt).getTime();
  if (Number.isNaN(savedAt)) {
    return false;
  }
  return now - savedAt <= ttlMs;
}
