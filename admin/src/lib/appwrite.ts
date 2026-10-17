import { Account, Client, ExecutionMethod, Functions } from 'appwrite';

import { createApi } from './api';

/**
 * Only public values live here. The endpoint and project id are shipped in the
 * Flutter APK too; the site holds no server key and never will.
 */
const env = import.meta.env;

export const ENDPOINT: string = env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
export const PROJECT_ID: string = env.VITE_APPWRITE_PROJECT_ID || '6aa42571001d94653e55';
export const FUNCTION_ID: string = env.VITE_API_FUNCTION_ID || 'api';

export const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
export const account = new Account(client);
const functions = new Functions(client);

/** Appwrite JWTs last 15 minutes; renew a minute early to avoid the boundary. */
const JWT_TTL_MS = 14 * 60 * 1000;
let cached: { jwt: string; expires: number } | null = null;

export function clearJwt(): void {
  cached = null;
}

async function getJwt(forceFresh = false): Promise<string> {
  if (!forceFresh && cached && Date.now() < cached.expires) return cached.jwt;
  const { jwt } = await account.createJWT();
  cached = { jwt, expires: Date.now() + JWT_TTL_MS };
  return jwt;
}

export const api = createApi({
  getJwt,
  async execute(path, body, jwt) {
    const e = await functions.createExecution({
      functionId: FUNCTION_ID,
      body: JSON.stringify(body),
      async: false,
      xpath: path,
      method: ExecutionMethod.POST,
      // Not "x-appwrite-*": Appwrite rejects caller-supplied headers with that
      // prefix before the function runs.
      headers: { 'x-dhara-jwt': jwt, 'content-type': 'application/json' },
    });
    return { responseBody: e.responseBody, responseStatusCode: e.responseStatusCode };
  },
});
