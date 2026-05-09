export function maskSecret(value, options = {}) {
  const secret = String(value ?? "");
  if (!secret) {
    return "";
  }
  const head = options.head ?? 4;
  const tail = options.tail ?? 4;
  if (secret.length <= head + tail + 3) {
    return "••••";
  }
  return `${secret.slice(0, head)}••••${secret.slice(-tail)}`;
}
