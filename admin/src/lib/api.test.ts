import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApi, messageOf, parseEnvelope } from './api';

const ok = (data: unknown) => JSON.stringify({ ok: true, data });
const fail = (code: string, message: string, details?: unknown) =>
  JSON.stringify({ ok: false, error: { code, message, details } });

describe('parseEnvelope', () => {
  it('returns the data of a successful answer', () => {
    expect(parseEnvelope<{ n: number }>(ok({ n: 3 }))).toEqual({ n: 3 });
  });

  it('treats a success with no data as an empty object', () => {
    expect(parseEnvelope(JSON.stringify({ ok: true }))).toEqual({});
  });

  it('throws the server code and message for a refusal', () => {
    try {
      parseEnvelope(fail('forbidden', 'Admins only.'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('forbidden');
      expect((e as ApiError).message).toBe('Admins only.');
    }
  });

  it('keeps the details the server attached', () => {
    try {
      parseEnvelope(fail('too_close', 'Too close.', { distanceM: 2 }));
    } catch (e) {
      expect((e as ApiError).details).toEqual({ distanceM: 2 });
    }
  });

  // An empty body is how a crashed function looks from the outside.
  it('reports an empty body as a function error', () => {
    expect(() => parseEnvelope('')).toThrowError(expect.objectContaining({ code: 'function_error' }));
  });

  it('reports non-JSON and non-object bodies as a bad response', () => {
    for (const raw of ['<html>502</html>', '[1,2]', '"text"', 'null']) {
      expect(() => parseEnvelope(raw)).toThrowError(expect.objectContaining({ code: 'bad_response' }));
    }
  });

  it('falls back to safe values when the error is malformed', () => {
    try {
      parseEnvelope(JSON.stringify({ ok: false, error: { code: 7 } }));
    } catch (e) {
      expect((e as ApiError).code).toBe('unknown');
      expect((e as ApiError).message).toBe('The request failed.');
    }
    expect(() => parseEnvelope(JSON.stringify({ ok: false }))).toThrowError(
      expect.objectContaining({ code: 'unknown' }),
    );
  });
});

describe('createApi', () => {
  it('sends the path, body and token and returns the data', async () => {
    const execute = vi.fn().mockResolvedValue({ responseBody: ok({ hello: 'world' }), responseStatusCode: 200 });
    const getJwt = vi.fn().mockResolvedValue('jwt-1');
    const api = createApi({ getJwt, execute });

    const out = await api.call<{ hello: string }>('/admin/stats', { a: 1 });

    expect(out).toEqual({ hello: 'world' });
    expect(execute).toHaveBeenCalledWith('/admin/stats', { a: 1 }, 'jwt-1');
    expect(getJwt).toHaveBeenCalledWith(false);
  });

  it('defaults the body to an empty object', async () => {
    const execute = vi.fn().mockResolvedValue({ responseBody: ok({}), responseStatusCode: 200 });
    await createApi({ getJwt: async () => 't', execute }).call('/admin/queue');
    expect(execute).toHaveBeenCalledWith('/admin/queue', {}, 't');
  });

  it('retries once with a fresh token when the cached one has expired', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ responseBody: fail('unauthenticated', 'Session expired.'), responseStatusCode: 200 })
      .mockResolvedValueOnce({ responseBody: ok({ fine: true }), responseStatusCode: 200 });
    const getJwt = vi.fn().mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh');
    const api = createApi({ getJwt, execute });

    expect(await api.call('/admin/stats')).toEqual({ fine: true });
    expect(getJwt).toHaveBeenNthCalledWith(1, false);
    expect(getJwt).toHaveBeenNthCalledWith(2, true);
    expect(execute).toHaveBeenLastCalledWith('/admin/stats', {}, 'fresh');
  });

  it('gives up after one retry rather than looping', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ responseBody: fail('unauthenticated', 'Session expired.'), responseStatusCode: 200 });
    const api = createApi({ getJwt: async () => 't', execute });

    await expect(api.call('/admin/stats')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry a refusal that a new token cannot fix', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ responseBody: fail('forbidden', 'Admins only.'), responseStatusCode: 200 });
    const api = createApi({ getJwt: async () => 't', execute });

    await expect(api.call('/admin/stats')).rejects.toMatchObject({ code: 'forbidden' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry a business rejection', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ responseBody: fail('already_decided', 'Already approved.'), responseStatusCode: 200 });
    await expect(createApi({ getJwt: async () => 't', execute }).call('/admin/review/decide')).rejects.toMatchObject({
      code: 'already_decided',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('passes a transport failure straight through', async () => {
    const execute = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(createApi({ getJwt: async () => 't', execute }).call('/admin/stats')).rejects.toThrow('Failed to fetch');
  });
});

describe('messageOf', () => {
  it('uses the server message for an ApiError', () => {
    expect(messageOf(new ApiError('x', 'Already approved.'))).toBe('Already approved.');
  });

  it('turns a network failure into plain language', () => {
    expect(messageOf(new TypeError('Failed to fetch'))).toMatch(/No connection/);
  });

  it('never returns an empty string', () => {
    expect(messageOf(undefined)).toBe('Something went wrong.');
    expect(messageOf(new Error(''))).toBe('Something went wrong.');
    expect(messageOf('weird')).toBe('Something went wrong.');
  });
});
