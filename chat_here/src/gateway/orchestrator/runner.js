export function createCancelToken() {
  const listeners = new Set();
  return {
    cancelled: false,
    reason: "",
    cancel(reason = "cancelled") {
      if (this.cancelled) {
        return;
      }
      this.cancelled = true;
      this.reason = reason;
      for (const listener of listeners) {
        listener(this.reason);
      }
    },
    subscribe(listener) {
      if (this.cancelled) {
        listener(this.reason);
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
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
      return await withTimeoutAndCancellation(operation(), timeoutMs, label, cancelToken);
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

function withTimeoutAndCancellation(promise, timeoutMs, label, cancelToken) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("timeoutMs must be a positive integer");
  }

  let timeoutId;
  let unsubscribe = null;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const candidates = [promise, timeout];
  if (cancelToken) {
    candidates.push(
      new Promise((_, reject) => {
        unsubscribe = cancelToken.subscribe((reason) => {
          reject(new Error(`${label} cancelled: ${reason || "cancelled"}`));
        });
      }),
    );
  }

  return Promise.race(candidates).finally(() => {
    clearTimeout(timeoutId);
    unsubscribe?.();
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
