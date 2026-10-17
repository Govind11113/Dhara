/**
 * Talks to the `api` Appwrite Function.
 *
 * The protocol matches the Flutter app: a POST execution with the caller's
 * short-lived JWT in `x-dhara-jwt`, answered with `{ok, data}` or
 * `{ok:false, error:{code, message}}`. The function decides who is an admin;
 * nothing in this file is a security boundary, it only reports what the server
 * said.
 *
 * Dependencies are injected so the envelope handling and the retry-on-expired-
 * token behaviour can be tested with no browser and no network.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

interface Envelope {
  ok?: boolean;
  data?: unknown;
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

/** Turns an execution's raw response body into data, or throws an ApiError. */
export function parseEnvelope<T>(raw: string): T {
  if (!raw) {
    // An empty body means the function itself crashed rather than answering.
    throw new ApiError('function_error', 'The server did not answer. Try again in a moment.');
  }

  let parsed: Envelope;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
    parsed = value as Envelope;
  } catch {
    throw new ApiError('bad_response', 'The server sent something unexpected.');
  }

  if (parsed.ok === true) return (parsed.data ?? {}) as T;

  const e = parsed.error;
  throw new ApiError(
    typeof e?.code === 'string' ? e.code : 'unknown',
    typeof e?.message === 'string' && e.message ? e.message : 'The request failed.',
    e?.details,
  );
}

export interface ExecutionResult {
  responseBody: string;
  responseStatusCode: number;
}

export interface ApiDeps {
  /** A valid JWT. `forceFresh` skips any cache. */
  getJwt(forceFresh?: boolean): Promise<string>;
  execute(path: string, body: unknown, jwt: string): Promise<ExecutionResult>;
}

export interface Api {
  call<T>(path: string, body?: unknown): Promise<T>;
}

export function createApi(deps: ApiDeps): Api {
  async function attempt<T>(path: string, body: unknown, forceFresh: boolean): Promise<T> {
    const jwt = await deps.getJwt(forceFresh);
    const res = await deps.execute(path, body, jwt);
    return parseEnvelope<T>(res.responseBody);
  }

  return {
    async call<T>(path: string, body: unknown = {}): Promise<T> {
      try {
        return await attempt<T>(path, body, false);
      } catch (e) {
        // A cached JWT can expire between being issued and being used. Ask for
        // a new one and try exactly once more; a second failure is real.
        if (e instanceof ApiError && e.code === 'unauthenticated') {
          return attempt<T>(path, body, true);
        }
        throw e;
      }
    },
  };
}

/** What to show a person for any thrown value. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) {
    if (/Failed to fetch|NetworkError|Load failed/i.test(e.message)) {
      return 'No connection to the server. Check your internet and try again.';
    }
    return e.message || 'Something went wrong.';
  }
  return 'Something went wrong.';
}
