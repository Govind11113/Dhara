/**
 * Seeds catalog data: app config, species, rewards, badges.
 *
 *   cd scripts && npm run seed
 *
 * Upserts by deterministic document ID, so re-running updates in place.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Databases } from 'node-appwrite';
import { DB_ID, CONFIG_SEED, SPECIES_SEED, REWARDS_SEED, BADGES_SEED } from './schema.mjs';

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new Databases(client);

const ok = (m) => console.log(`  \u001b[32m+\u001b[0m ${m}`);
const upd = (m) => console.log(`  \u001b[36m~\u001b[0m ${m}`);
const warn = (m) => console.log(`  \u001b[33m!\u001b[0m ${m}`);

/** Appwrite IDs allow a-z A-Z 0-9 . - _ and must not start with a special char. */
const toId = (raw) =>
  raw
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '_')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 36);

async function upsert(collectionId, docId, data) {
  const id = toId(docId);
  try {
    await db.createDocument(DB_ID, collectionId, id, data);
    ok(`${collectionId}/${id}`);
  } catch (e) {
    if (e.code === 409) {
      try {
        await db.updateDocument(DB_ID, collectionId, id, data);
        upd(`${collectionId}/${id}`);
      } catch (e2) {
        warn(`${collectionId}/${id} update -> [${e2.code}] ${e2.message}`);
      }
    } else {
      warn(`${collectionId}/${id} -> [${e.code}] ${e.message}`);
    }
  }
}

async function main() {
  console.log('\u001b[1mapp_config\u001b[0m');
  for (const [key, value, valueType, description] of CONFIG_SEED) {
    await upsert('app_config', key, { key, value, valueType, description });
  }

  console.log('\n\u001b[1mspecies\u001b[0m');
  for (const [
    code, name, scientificName, emoji, co2PerYearGrams,
    creditsPerVerification, matureHeightCm, careTip, sortOrder,
  ] of SPECIES_SEED) {
    await upsert('species', code, {
      code, name, scientificName, emoji, co2PerYearGrams,
      creditsPerVerification, matureHeightCm, careTip,
      sortOrder, isActive: true,
    });
  }

  console.log('\n\u001b[1mrewards\u001b[0m');
  for (const [
    title, subtitle, description, type, creditsCost, faceValueInr,
    partner, emoji, , minLevel, requiresElectricityAccount,
    stockRemaining, sortOrder,
  ] of REWARDS_SEED) {
    await upsert('rewards', title, {
      title, subtitle, description, type, creditsCost, faceValueInr,
      partner, emoji, minLevel, requiresElectricityAccount,
      stockRemaining, sortOrder, isActive: true,
    });
  }

  console.log('\n\u001b[1mbadges\u001b[0m');
  for (const [
    code, title, description, emoji, tier, metric, threshold, bonusCredits, sortOrder,
  ] of BADGES_SEED) {
    await upsert('badges', code, {
      code, title, description, emoji, tier, metric,
      threshold, bonusCredits, sortOrder, isActive: true,
    });
  }

  console.log('\n\u001b[32mSeeding complete.\u001b[0m');
}

main().catch((e) => {
  console.error('\nFATAL', e);
  process.exit(1);
});
