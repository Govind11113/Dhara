/**
 * Grants (or revokes) the ngo label.
 *
 *   cd scripts && node make_ngo.mjs partner@ngo.org
 *   cd scripts && node make_ngo.mjs partner@ngo.org --revoke
 *
 * The label lets an account sign in to the dashboard's planting-requests area
 * and call the /ngo/ routes. It grants nothing under /admin/. It can only be set
 * with the server key, so a user cannot give it to themselves from the app.
 * Existing labels are preserved.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Query, Users } from 'node-appwrite';

const email = (process.argv[2] || '').trim().toLowerCase();
const revoke = process.argv.includes('--revoke');

if (!email || email.startsWith('--')) {
  console.error('Usage: node make_ngo.mjs <email> [--revoke]');
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
      'Create it in the Appwrite console under Auth (or sign up in the Dhara ' +
      'app), then run this again.',
  );
  process.exit(2);
}

const labels = new Set(user.labels ?? []);
if (revoke) labels.delete('ngo');
else labels.add('ngo');

await users.updateLabels(user.$id, [...labels]);
console.log(
  `${revoke ? 'Removed ngo from' : 'Granted ngo to'} ${user.email} ` +
    `(labels now: ${[...labels].join(', ') || 'none'})`,
);
