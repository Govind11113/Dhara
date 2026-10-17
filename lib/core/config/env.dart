// Central Appwrite + tuning constants.
//
// Values mirror scripts/schema.mjs (collection / bucket IDs) and
// scripts/seed.mjs CONFIG_SEED (tunable defaults). The server remains the
// authority — these are client-side mirrors for reads and UX hints only.
class Env {
  static const endpoint = 'https://sgp.cloud.appwrite.io/v1';
  static const projectId = '6aa42571001d94653e55';
  static const databaseId = 'dhara';
  static const apiFunctionId = 'api';
}

class Col {
  static const profiles = 'profiles';
  static const trees = 'trees';
  static const treeVerifications = 'tree_verifications';
  static const species = 'species';
  static const items = 'items';
  static const custodyEvents = 'custody_events';
  static const rewards = 'rewards';
  static const redemptions = 'redemptions';
  static const creditLedger = 'credit_ledger';
  static const electricityAccounts = 'electricity_accounts';
  static const leaderboard = 'leaderboard';
  static const badges = 'badges';
  static const userBadges = 'user_badges';
  static const feedback = 'feedback';
  static const footprints = 'footprints';
}

class Buckets {
  static const treePhotos = 'tree_photos';
  static const billDocs = 'bill_docs';
  static const avatars = 'avatars';
  static const rewardImages = 'reward_images';
  static const feedbackMedia = 'feedback_media';
}

class Tunables {
  static const verifyRadiusM = 30.0;
  static const minTreeSpacingM = 3.0;
  static const maxGpsAccuracyM = 20.0;
  static const vestingMonths = 12;
}
