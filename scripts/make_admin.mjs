/**
 * Grants (or revokes) the admin label.
 *
 *   cd scripts && node make_admin.mjs you@example.com
 *   cd scripts && node make_admin.mjs you@example.com --revoke
 *
 * The label is how the admin panel and every /admin/ route decide who may use
 * them. It can only be set with the server key, so it is not something a user
 * can give themselves from the app. Existing labels are preserved.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Query, Users } from 'node-appwrite';

const email = (process.argv[2] || '').trim().toLowerCase();
const revoke = process.argv.includes('--revoke');

if (!email || email.startsWith('--')) {
  console.error('Usage: node make_admin.mjs <email> [--revoke]');
  process.exit(1);
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const users = new Users(client);

const found = await users.list([Query.equal('email', email), Query.limit(1)]);
const user = found.users[0];

if (!user) {
  console.error(
    `No Appwrite account exists for ${email}.\n` +
      'Sign up with that address in the Dhara app first (or create it in the ' +
      'console under Auth), then run this again.',
  );
  process.exit(2);
}

const labels = new Set(user.labels ?? []);
if (revoke) labels.delete('admin');
else labels.add('admin');

await users.updateLabels(user.$id, [...labels]);
console.log(
  `${revoke ? 'Removed admin from' : 'Granted admin to'} ${user.email} ` +
    `(labels now: ${[...labels].join(', ') || 'none'})`,
);
