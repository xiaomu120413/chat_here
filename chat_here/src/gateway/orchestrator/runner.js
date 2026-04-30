export function createCancelToken() {
  return {
    cancelled: false,
    reason: "",
    cancel(reason = "cancelled") {
      this.cancelled = true;
      this.reason = reason;
    },
  };
}

export async function runAdapterStep(label, operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 0;
  const cancelToken = options.cancelToken ?? null;

  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    assertNotCancelled(cancelToken, label);

    try {
      return await withTimeout(operation(), timeoutMs, label);
    } catch (error) {
      lastError = error;

      if (isCancelledError(error)) {
        throw error;
      }

      if (attempt >= retries) {
        throw error;
      }

      attempt += 1;
    }
  }

  throw lastError;
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("timeoutMs must be a positive integer");
  }

  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function assertNotCancelled(cancelToken, label) {
  if (cancelToken?.cancelled) {
    throw new Error(`${label} cancelled: ${cancelToken.reason || "cancelled"}`);
  }
}

function isCancelledError(error) {
  return error instanceof Error && error.message.includes(" cancelled:");
}
