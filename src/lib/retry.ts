export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return true to retry, false to give up immediately (e.g. 4xx). */
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4000,
  shouldRetry: () => true,
};

function backoffDelay(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  return Math.floor(exp / 2 + Math.random() * (exp / 2)); // full-range jitter on the upper half
}

/** Exponential backoff with jitter. No dependency — this project keeps
 * deps minimal for `bun build --compile`. */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === opts.maxAttempts || !opts.shouldRetry(error)) throw error;
      await Bun.sleep(backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs));
    }
  }

  throw lastError;
}

export class HttpStatusError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Retries network errors and 5xx/429; a 4xx (other than 429) is treated
 * as non-retryable — the request is wrong, retrying won't help. */
export async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  options?: Omit<RetryOptions, "shouldRetry">,
): Promise<Response> {
  return withRetry(
    async () => {
      const response = await fetch(input, init);
      if (!response.ok && (response.status >= 500 || response.status === 429)) {
        throw new HttpStatusError(response.status, `HTTP ${response.status} for ${input}`);
      }
      return response;
    },
    { ...options, shouldRetry: (error) => !(error instanceof HttpStatusError) || error.status >= 500 || error.status === 429 },
  );
}
