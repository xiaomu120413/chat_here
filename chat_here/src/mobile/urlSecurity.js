const SENSITIVE_QUERY_KEYS = Object.freeze(["token", "gatewayToken", "access_token"]);

export function createSanitizedMobileUrl(href) {
  try {
    const url = new URL(href);
    let changed = false;
    for (const key of SENSITIVE_QUERY_KEYS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? url.toString() : href;
  } catch {
    return href;
  }
}
