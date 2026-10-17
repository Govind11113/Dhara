import { Permission, Role, IndexType } from 'node-appwrite';

export const DB_ID = process.env.APPWRITE_DATABASE_ID || 'dhara';
export const DB_NAME = 'Dhara Green Credits';

const S = (key, size, required = false, def = null, array = false) => ({
  kind: 'string', key, size, required, def, array,
});
const E = (key, elements, required = false, def = null) => ({
  kind: 'enum', key, elements, required, def,
});
const I = (key, required = false, def = null, min = null, max = null) => ({
  kind: 'integer', key, required, def, min, max,
});
const F = (key, required = false, def = null, min = null, max = null) => ({
  kind: 'float', key, required, def, min, max,
});
const B = (key, required = false, def = null) => ({ kind: 'boolean', key, required, def });
const D = (key, required = false, def = null) => ({ kind: 'datetime', key, required, def });
const EM = (key, required = false) => ({ kind: 'email', key, required });

const idx = (key, attributes, type = IndexType.Key, orders = null) => ({
  key, attributes, type, orders,
});

/**
 * Writes are server-only (Appwrite Function with an API key) for every
 * collection that mints or moves credits. Clients never write those directly.
 * `documentSecurity: true` + per-document read grants keep users scoped to
 * their own rows.
 */
const SERVER_ONLY = { permissions: [], documentSecurity: true };
const CATALOG = {
  permissions: [Permission.read(Role.users())],
  documentSecurity: false,
};
const PUBLIC_READ = {
  permissions: [Permission.read(Role.users())],
  documentSecurity: true,
};

export const COLLECTIONS = [
  {
    id: 'profiles',
    name: 'User Profiles',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      S('name', 128, true),
      EM('email', true),
      S('phone', 24),
      S('avatarFileId', 64),
      S('referralCode', 12),
      S('referredBy', 64),
      I('creditsAvailable', true, 0, 0),
      I('creditsLifetime', true, 0, 0),
      I('creditsPending', true, 0, 0),
      I('creditsSpent', true, 0, 0),
      I('xp', true, 0, 0),
      I('level', true, 1, 1),
      I('treesPlanted', true, 0, 0),
      I('treesAlive', true, 0, 0),
      I('bottlesReturned', true, 0, 0),
      I('co2OffsetGrams', true, 0, 0),
      I('streakCount', true, 0, 0),
      I('longestStreak', true, 0, 0),
      D('lastVerifyAt'),
      I('trustScore', true, 100, 0, 100),
      B('isBanned', true, false),
      S('banReason', 256),
      B('electricityVerified', true, false),
      S('primaryConsumerNo', 40),
      S('deviceFingerprint', 128),
      S('fcmToken', 256),
      D('lastActiveAt'),
    ],
    indexes: [
      idx('idx_userId', ['userId'], IndexType.Unique),
      idx('idx_referralCode', ['referralCode'], IndexType.Unique),
      idx('idx_lifetime', ['creditsLifetime'], IndexType.Key, ['DESC']),
      idx('idx_level_xp', ['level', 'xp'], IndexType.Key, ['DESC', 'DESC']),
      idx('idx_name_search', ['name'], IndexType.Fulltext),
    ],
  },

  {
    id: 'trees',
    name: 'Trees',
    ...SERVER_ONLY,
    attributes: [
      S('ownerId', 64, true),
      S('speciesCode', 48, true),
      S('speciesName', 96),
      S('nickname', 64),
      F('lat', true, null, -90, 90),
      F('lng', true, null, -180, 180),
      S('geohash', 16, true),
      F('accuracyM', true, null, 0, 10000),
      S('addressLabel', 256),
      // The rest of the GPS reading, kept so a registration can be audited the
      // way a GPS-camera stamp can. All optional with a 0 default: they are
      // added to a collection that already holds rows, and a required attribute
      // would have no value to give those.
      //
      // Bounds are deliberately loose. A device that reports a strange altitude
      // should not fail an otherwise valid plant, and the route clamps into
      // these ranges before writing.
      F('altitudeM', false, 0, -1000, 10000),
      F('altitudeAccuracyM', false, 0, 0, 10000),
      F('headingDeg', false, 0, 0, 360),
      F('speedMps', false, 0, 0, 1000),
      // The GPS chip's own timestamp, which is the device's clock and therefore
      // a claim rather than a fact. `plantedAt` stays the server's time and
      // remains the authority; a gap between the two is itself a fraud signal.
      D('fixCapturedAt'),
      S('plantPhotoFileId', 64, true),
      S('plantPhash', 32),
      D('plantedAt', true),
      E('status', ['pending_review', 'alive', 'at_risk', 'missed', 'dead', 'rejected'], true, 'pending_review'),
      S('rejectReason', 256),
      I('verificationCount', true, 0, 0),
      I('consecutiveMisses', true, 0, 0),
      I('heightCm', true, 0, 0),
      I('creditsVested', true, 0, 0),
      I('creditsPending', true, 0, 0),
      I('vestingMonths', true, 12, 1),
      D('nextVerifyAfter'),
      D('verifyWindowEnd'),
      D('lastVerifiedAt'),
      B('mockLocationDetected', true, false),
      B('deviceIntegrityOk', true, true),
      S('markerCode', 32),
      // Server-side vision verdict. Optional with defaults: both collections
      // already hold rows, and a required attribute would have no value for
      // those. The client's own plantConfidence stays a hint — these are what
      // the server actually decided on.
      S('aiVerdict', 1024),
      F('aiConfidence', false, 0, 0, 1),
      S('aiModel', 64),
    ],
    indexes: [
      idx('idx_owner', ['ownerId']),
      idx('idx_owner_status', ['ownerId', 'status']),
      idx('idx_geohash', ['geohash']),
      idx('idx_status_next', ['status', 'nextVerifyAfter']),
      idx('idx_phash', ['plantPhash']),
      idx('idx_marker', ['markerCode'], IndexType.Unique),
    ],
  },

  {
    id: 'tree_verifications',
    name: 'Tree Verifications',
    ...SERVER_ONLY,
    attributes: [
      S('treeId', 64, true),
      S('userId', 64, true),
      S('monthKey', 7, true),
      S('photoFileId', 64, true),
      S('phash', 32),
      F('lat', true, null, -90, 90),
      F('lng', true, null, -180, 180),
      F('accuracyM', true, null, 0, 10000),
      F('distanceM', true, null, 0, 100000),
      S('labels', 1024),
      F('plantConfidence', true, 0, 0, 1),
      I('heightCm', true, 0, 0),
      E('status', ['approved', 'rejected', 'manual_review'], true, 'manual_review'),
      S('rejectReason', 256),
      I('creditsAwarded', true, 0, 0),
      B('mockLocationDetected', true, false),
      B('deviceIntegrityOk', true, true),
      I('phashDistanceToNearest', true, 64, 0),
      S('aiVerdict', 1024),
      F('aiConfidence', false, 0, 0, 1),
      S('aiModel', 64),
      D('verifiedAt', true),
    ],
    indexes: [
      idx('idx_tree_month', ['treeId', 'monthKey'], IndexType.Unique),
      idx('idx_user', ['userId']),
      idx('idx_user_verifiedAt', ['userId', 'verifiedAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_status', ['status']),
      idx('idx_phash', ['phash']),
    ],
  },

  {
    id: 'species',
    name: 'Tree Species',
    ...CATALOG,
    attributes: [
      S('code', 48, true),
      S('name', 96, true),
      S('scientificName', 128),
      S('emoji', 8),
      I('co2PerYearGrams', true, 0, 0),
      I('creditsPerVerification', true, 10, 0),
      I('matureHeightCm', true, 0, 0),
      S('careTip', 512),
      B('isActive', true, true),
      I('sortOrder', true, 100, 0),
    ],
    indexes: [
      idx('idx_code', ['code'], IndexType.Unique),
      idx('idx_active_sort', ['isActive', 'sortOrder']),
    ],
  },

  {
    id: 'items',
    name: 'Tracked Items',
    ...PUBLIC_READ,
    attributes: [
      S('code', 64, true),
      E('productType', ['pet_bottle', 'glass_bottle', 'aluminium_can', 'tetra_carton', 'ewaste', 'other'], true, 'pet_bottle'),
      S('productName', 96),
      I('sizeMl', true, 0, 0),
      S('brandName', 96),
      S('factoryId', 64, true),
      S('batchId', 64),
      E('state', [
        'at_factory', 'with_wholesaler', 'with_retailer', 'with_consumer',
        'returned_to_retailer', 'returned_to_wholesaler', 'returned_to_factory',
        'recycled', 'voided',
      ], true, 'at_factory'),
      S('holderId', 64, true),
      E('holderRole', ['factory', 'wholesaler', 'retailer', 'consumer'], true, 'factory'),
      I('cycleCount', true, 0, 0),
      I('creditValue', true, 2, 0),
      I('transferCount', true, 0, 0),
      D('lastTransferAt'),
      B('rewardClaimedThisCycle', true, false),
      B('isVoid', true, false),
    ],
    indexes: [
      idx('idx_code', ['code'], IndexType.Unique),
      idx('idx_holder', ['holderId']),
      idx('idx_holder_state', ['holderId', 'state']),
      idx('idx_state', ['state']),
      idx('idx_factory_batch', ['factoryId', 'batchId']),
    ],
  },

  {
    id: 'custody_events',
    name: 'Custody Events',
    ...SERVER_ONLY,
    attributes: [
      S('itemId', 64, true),
      S('code', 64, true),
      S('fromId', 64, true),
      S('toId', 64, true),
      E('fromRole', ['factory', 'wholesaler', 'retailer', 'consumer'], true, 'factory'),
      E('toRole', ['factory', 'wholesaler', 'retailer', 'consumer'], true, 'consumer'),
      S('fromState', 32, true),
      S('toState', 32, true),
      E('direction', ['forward', 'return', 'recycle'], true, 'forward'),
      F('lat', false, null, -90, 90),
      F('lng', false, null, -180, 180),
      F('distanceM', true, 0, 0),
      S('transferToken', 64),
      I('creditsAwarded', true, 0, 0),
      I('cycleCount', true, 0, 0),
      D('occurredAt', true),
    ],
    indexes: [
      idx('idx_item', ['itemId']),
      idx('idx_item_time', ['itemId', 'occurredAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_from', ['fromId']),
      idx('idx_to', ['toId']),
      idx('idx_token', ['transferToken']),
    ],
  },

  {
    id: 'transfer_tokens',
    name: 'Transfer Handshake Tokens',
    ...SERVER_ONLY,
    attributes: [
      S('token', 64, true),
      S('issuerId', 64, true),
      E('issuerRole', ['factory', 'wholesaler', 'retailer', 'consumer'], true, 'retailer'),
      S('itemIds', 4096, true),
      I('itemCount', true, 0, 0),
      E('intent', ['forward', 'return', 'recycle'], true, 'forward'),
      F('lat', false, null, -90, 90),
      F('lng', false, null, -180, 180),
      D('expiresAt', true),
      B('consumed', true, false),
      S('consumedBy', 64),
      D('consumedAt'),
    ],
    indexes: [
      idx('idx_token', ['token'], IndexType.Unique),
      idx('idx_issuer', ['issuerId']),
      idx('idx_expires', ['expiresAt']),
    ],
  },

  {
    id: 'credit_ledger',
    name: 'Credit Ledger',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      I('delta', true, null),
      I('balanceAfter', true, 0),
      E('source', [
        'tree_plant', 'tree_verify', 'tree_vesting', 'bottle_return', 'referral',
        'streak_bonus', 'badge_bonus', 'redemption', 'reversal', 'admin_adjustment',
      ], true, 'tree_verify'),
      S('refId', 64),
      S('idempotencyKey', 128, true),
      S('note', 256),
      D('occurredAt', true),
    ],
    indexes: [
      idx('idx_idem', ['idempotencyKey'], IndexType.Unique),
      idx('idx_user_time', ['userId', 'occurredAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_user_source', ['userId', 'source']),
      idx('idx_ref', ['refId']),
    ],
  },

  {
    id: 'rewards',
    name: 'Reward Catalog',
    ...CATALOG,
    attributes: [
      S('title', 128, true),
      S('subtitle', 256),
      S('description', 1024),
      E('type', ['electricity_bill', 'movie_voucher', 'mobile_recharge', 'shopping_voucher', 'metro_pass', 'tree_donation', 'cash_transfer'], true, 'electricity_bill'),
      I('creditsCost', true, 100, 1),
      I('faceValueInr', true, 0, 0),
      S('partner', 96),
      S('emoji', 8),
      S('imageFileId', 64),
      S('termsUrl', 512),
      I('stockRemaining', true, 0, 0),
      I('minLevel', true, 1, 1),
      B('requiresElectricityAccount', true, false),
      B('isActive', true, true),
      I('sortOrder', true, 100, 0),
    ],
    indexes: [
      idx('idx_active_sort', ['isActive', 'sortOrder']),
      idx('idx_type', ['type']),
      idx('idx_cost', ['creditsCost']),
    ],
  },

  {
    id: 'redemptions',
    name: 'Redemptions',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      S('rewardId', 64, true),
      S('rewardTitle', 128, true),
      E('type', ['electricity_bill', 'movie_voucher', 'mobile_recharge', 'shopping_voucher', 'metro_pass', 'tree_donation', 'cash_transfer'], true, 'electricity_bill'),
      I('creditsSpent', true, 0, 0),
      I('faceValueInr', true, 0, 0),
      E('status', ['pending', 'processing', 'fulfilled', 'failed', 'cancelled'], true, 'pending'),
      S('payload', 2048),
      S('voucherCode', 128),
      S('failureReason', 256),
      S('idempotencyKey', 128, true),
      D('requestedAt', true),
      D('fulfilledAt'),
    ],
    indexes: [
      idx('idx_idem', ['idempotencyKey'], IndexType.Unique),
      idx('idx_user_time', ['userId', 'requestedAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_status', ['status']),
    ],
  },

  {
    id: 'electricity_accounts',
    name: 'Electricity Accounts',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      S('consumerNo', 40, true),
      S('provider', 96, true),
      S('providerCode', 24, true),
      S('stateName', 64),
      S('holderName', 128),
      S('billFileId', 64),
      S('ocrExcerpt', 2048),
      F('ocrMatchScore', true, 0, 0, 1),
      E('status', ['pending_review', 'verified', 'rejected'], true, 'pending_review'),
      E('method', ['ocr', 'manual_review', 'api'], true, 'ocr'),
      S('rejectReason', 256),
      B('isPrimary', true, true),
      D('submittedAt', true),
      D('verifiedAt'),
    ],
    indexes: [
      idx('idx_consumer', ['consumerNo'], IndexType.Unique),
      idx('idx_user', ['userId']),
      idx('idx_status', ['status']),
    ],
  },

  {
    id: 'leaderboard',
    name: 'Leaderboard Snapshots',
    ...CATALOG,
    attributes: [
      S('period', 16, true),
      S('userId', 64, true),
      S('name', 128, true),
      S('avatarFileId', 64),
      I('rank', true, 0, 0),
      I('score', true, 0, 0),
      I('treesAlive', true, 0, 0),
      I('bottlesReturned', true, 0, 0),
      I('level', true, 1, 1),
      I('streakCount', true, 0, 0),
      S('regionCode', 32),
      D('computedAt', true),
    ],
    indexes: [
      idx('idx_period_user', ['period', 'userId'], IndexType.Unique),
      idx('idx_period_rank', ['period', 'rank']),
      idx('idx_period_score', ['period', 'score'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_region', ['period', 'regionCode', 'rank']),
    ],
  },

  {
    id: 'badges',
    name: 'Badge Catalog',
    ...CATALOG,
    attributes: [
      S('code', 48, true),
      S('title', 96, true),
      S('description', 256),
      S('emoji', 8),
      E('tier', ['bronze', 'silver', 'gold', 'platinum'], true, 'bronze'),
      E('metric', ['trees_planted', 'trees_alive', 'verifications', 'bottles_returned', 'streak', 'credits_lifetime', 'referrals'], true, 'trees_planted'),
      I('threshold', true, 1, 1),
      I('bonusCredits', true, 0, 0),
      B('isActive', true, true),
      I('sortOrder', true, 100, 0),
    ],
    indexes: [
      idx('idx_code', ['code'], IndexType.Unique),
      idx('idx_metric', ['metric', 'threshold']),
    ],
  },

  {
    id: 'user_badges',
    name: 'Earned Badges',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      S('badgeCode', 48, true),
      S('badgeTitle', 96, true),
      S('emoji', 8),
      E('tier', ['bronze', 'silver', 'gold', 'platinum'], true, 'bronze'),
      I('bonusCredits', true, 0, 0),
      D('earnedAt', true),
    ],
    indexes: [
      idx('idx_user_badge', ['userId', 'badgeCode'], IndexType.Unique),
      idx('idx_user_time', ['userId', 'earnedAt'], IndexType.Key, ['ASC', 'DESC']),
    ],
  },

  {
    id: 'notifications',
    name: 'Notifications',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      S('title', 128, true),
      S('body', 512, true),
      E('type', ['verify_due', 'verify_result', 'credits', 'badge', 'redemption', 'custody', 'system'], true, 'system'),
      S('refId', 64),
      S('deepLink', 256),
      B('isRead', true, false),
      D('createdAt', true),
    ],
    indexes: [
      idx('idx_user_time', ['userId', 'createdAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_user_unread', ['userId', 'isRead']),
    ],
  },

  {
    id: 'photo_hashes',
    name: 'Photo Perceptual Hashes',
    ...SERVER_ONLY,
    attributes: [
      S('phash', 32, true),
      S('phashPrefix', 8, true),
      S('userId', 64, true),
      E('refType', ['tree_plant', 'tree_verify', 'bill'], true, 'tree_verify'),
      S('refId', 64, true),
      S('fileId', 64),
      D('createdAt', true),
    ],
    indexes: [
      idx('idx_prefix', ['phashPrefix']),
      idx('idx_phash', ['phash']),
      idx('idx_user', ['userId']),
      idx('idx_ref', ['refType', 'refId']),
    ],
  },

  {
    id: 'fraud_flags',
    name: 'Fraud Flags',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      E('kind', [
        'mock_location', 'duplicate_photo', 'not_a_plant', 'out_of_radius',
        'poor_gps_accuracy', 'integrity_failed', 'velocity_abuse',
        'self_transfer', 'token_expired', 'duplicate_consumer_no', 'manual_report',
      ], true, 'manual_report'),
      E('severity', ['low', 'medium', 'high', 'critical'], true, 'low'),
      S('detail', 1024),
      S('refType', 32),
      S('refId', 64),
      I('trustScoreDelta', true, 0),
      B('resolved', true, false),
      S('resolution', 256),
      D('createdAt', true),
    ],
    indexes: [
      idx('idx_user_time', ['userId', 'createdAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_kind', ['kind']),
      idx('idx_unresolved', ['resolved', 'severity']),
    ],
  },

  {
    id: 'feedback',
    name: 'User Feedback',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      E('category', ['bug', 'idea', 'reward_request', 'verification_dispute', 'other'], true, 'other'),
      S('message', 2000, true),
      S('screenshotFileId', 64),
      // Set when the feedback is about a specific tree or check-in, so a
      // dispute about an AI rejection can be traced back to the submission.
      S('refType', 32),
      S('refId', 64),
      S('appVersion', 32),
      S('platform', 16),
      S('deviceModel', 96),
      E('status', ['open', 'triaged', 'answered', 'closed'], true, 'open'),
      S('adminReply', 1000),
      D('createdAt', true),
    ],
    indexes: [
      idx('idx_user_time', ['userId', 'createdAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_status', ['status']),
      idx('idx_category', ['category']),
    ],
  },

  {
    id: 'ai_inspections',
    name: 'AI Inspections',
    ...SERVER_ONLY,
    // One row per call to the vision model, including ones that failed. This is
    // the record that says which model judged which photo, how long it took and
    // how often it was unavailable, so a provider can be judged on evidence.
    attributes: [
      S('userId', 64, true),
      S('refType', 32),
      S('refId', 64),
      S('fileId', 64),
      S('provider', 32),
      S('model', 96),
      I('latencyMs', false, 0, 0),
      I('attempts', false, 0, 0),
      // ok | skipped | unavailable
      S('status', 16),
      S('error', 256),
      // approve | review | reject: what the server decided on this photo.
      S('action', 16),
      F('confidence', false, 0, 0, 1),
      S('verdict', 1024),
      D('createdAt', true),
    ],
    indexes: [
      idx('idx_user_time', ['userId', 'createdAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_action', ['action']),
      idx('idx_status', ['status']),
      idx('idx_time', ['createdAt'], IndexType.Key, ['DESC']),
    ],
  },

  {
    id: 'admin_actions',
    name: 'Admin Actions',
    ...SERVER_ONLY,
    // Append-only audit trail: every write an admin makes through the panel
    // leaves a row here, so "who approved that tree?" always has an answer.
    attributes: [
      S('adminId', 64, true),
      S('adminEmail', 128),
      S('action', 48, true),
      S('targetType', 32),
      S('targetId', 64),
      S('detail', 1024),
      D('createdAt', true),
    ],
    indexes: [
      idx('idx_time', ['createdAt'], IndexType.Key, ['DESC']),
      idx('idx_admin_time', ['adminId', 'createdAt'], IndexType.Key, ['ASC', 'DESC']),
      idx('idx_target', ['targetType', 'targetId']),
    ],
  },

  {
    id: 'footprints',
    name: 'Carbon Footprints',
    ...SERVER_ONLY,
    // One row per member per month. Personal data: written only by the api
    // function, readable by its owner, and shown to admins only as totals over
    // many members. Never connected to credits.
    attributes: [
      S('userId', 64, true),
      S('monthKey', 7, true),
      I('householdSize', false, 1, 1, 20),
      // The numbers the member entered, so a month can be re-opened and edited.
      S('inputs', 2000),
      F('monthKg', true, null, 0, 1000000),
      F('yearKg', true, null, 0, 12000000),
      F('electricityKg', false, 0, 0, 1000000),
      F('cookingKg', false, 0, 0, 1000000),
      F('transportKg', false, 0, 0, 1000000),
      F('airKg', false, 0, 0, 1000000),
      // Which set of emission factors produced these figures.
      S('factorsVersion', 16, true),
      D('createdAt'),
      D('updatedAt', true),
    ],
    indexes: [
      idx('idx_user_month', ['userId', 'monthKey'], IndexType.Unique),
      idx('idx_month', ['monthKey']),
      idx('idx_user_time', ['userId', 'updatedAt'], IndexType.Key, ['ASC', 'DESC']),
    ],
  },

  {
    id: 'app_config',
    name: 'App Config',
    ...CATALOG,
    attributes: [
      S('key', 64, true),
      S('value', 1024, true),
      E('valueType', ['int', 'float', 'bool', 'string', 'json'], true, 'int'),
      S('description', 256),
    ],
    indexes: [idx('idx_key', ['key'], IndexType.Unique)],
  },

  {
    id: 'partner_roles',
    name: 'Partner Roles',
    ...SERVER_ONLY,
    attributes: [
      S('userId', 64, true),
      E('role', ['factory', 'wholesaler', 'retailer'], true, 'retailer'),
      S('orgName', 128, true),
      S('gstin', 24),
      S('addressLabel', 256),
      F('lat', false, null, -90, 90),
      F('lng', false, null, -180, 180),
      E('status', ['pending', 'approved', 'suspended'], true, 'pending'),
      D('createdAt', true),
    ],
    indexes: [
      idx('idx_user_role', ['userId', 'role'], IndexType.Unique),
      idx('idx_role_status', ['role', 'status']),
    ],
  },
];

export const BUCKETS = [
  {
    id: 'tree_photos',
    name: 'Tree Photos',
    permissions: [Permission.create(Role.users())],
    fileSecurity: true,
    maximumFileSize: 12 * 1024 * 1024,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
    compression: 'gzip',
    encryption: true,
    antivirus: true,
  },
  {
    id: 'bill_docs',
    name: 'Electricity Bills',
    permissions: [Permission.create(Role.users())],
    fileSecurity: true,
    maximumFileSize: 12 * 1024 * 1024,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'heic'],
    compression: 'gzip',
    encryption: true,
    antivirus: true,
  },
  {
    id: 'avatars',
    name: 'Avatars',
    permissions: [Permission.create(Role.users()), Permission.read(Role.users())],
    fileSecurity: true,
    maximumFileSize: 5 * 1024 * 1024,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    compression: 'gzip',
    encryption: false,
    antivirus: true,
  },
  {
    id: 'feedback_media',
    name: 'Feedback Screenshots',
    permissions: [Permission.create(Role.users())],
    fileSecurity: true,
    maximumFileSize: 8 * 1024 * 1024,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    compression: 'gzip',
    encryption: false,
    antivirus: true,
  },
  {
    id: 'reward_images',
    name: 'Reward Images',
    permissions: [Permission.read(Role.users())],
    fileSecurity: false,
    maximumFileSize: 5 * 1024 * 1024,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'svg'],
    compression: 'gzip',
    encryption: false,
    antivirus: true,
  },
];

export const CONFIG_SEED = [
  ['tree.verify_radius_m', '30', 'int', 'User must stand within this many metres of the tree'],
  ['tree.min_spacing_m', '3', 'int', 'Two distinct trees must be at least this far apart'],
  ['tree.max_gps_accuracy_m', '20', 'int', 'Reject GPS fixes worse than this'],
  ['tree.plant_credits', '5', 'int', 'Credits granted at planting'],
  ['tree.credits_per_verification', '10', 'int', 'Credits per approved monthly check-in'],
  ['tree.vesting_months', '12', 'int', 'Monthly verifications before a tree fully vests'],
  ['tree.plant_confidence_min', '0.55', 'float', 'Minimum ML Kit plant-label confidence'],
  ['tree.verify_window_days', '7', 'int', 'Days the monthly verification window stays open'],
  ['tree.grace_misses', '2', 'int', 'Consecutive misses before a tree is marked dead'],
  ['fraud.phash_hamming_threshold', '8', 'int', 'Below this Hamming distance photos count as duplicates'],
  ['fraud.trust_score_block_below', '40', 'int', 'Auto-route to manual review below this trust score'],
  ['vision.ai_enabled', 'true', 'bool', 'Send tree photos to the server-side vision model'],
  ['vision.ai_confidence_min', '0.6', 'float', 'Below this AI confidence a submission is held for review'],
  ['vision.ai_hard_reject', 'true', 'bool', 'Let the AI reject outright when it is confident the photo is fake'],
  ['vision.model', 'nvidia/nemotron-3.5-super-vl:free', 'string', 'OpenRouter vision model used to verify tree photos'],
  ['vision.on_unavailable', 'approve', 'string', 'When the vision model cannot answer: approve (rely on GPS/pHash/ML Kit) or review (hold for a person)'],
  ['vision.timeout_ms', '12000', 'int', 'Give up on the vision model after this long and fall back'],
  ['bottle.credits_pet_bottle', '2', 'int', 'Credits for returning a PET bottle'],
  ['bottle.credits_glass_bottle', '3', 'int', 'Credits for returning a glass bottle'],
  ['bottle.credits_aluminium_can', '3', 'int', 'Credits for returning an aluminium can'],
  ['bottle.credits_tetra_carton', '2', 'int', 'Credits for returning a tetra carton'],
  ['bottle.transfer_token_ttl_s', '90', 'int', 'Handshake token lifetime in seconds'],
  ['bottle.max_transfer_distance_m', '150', 'int', 'Max distance between two parties during handover'],
  ['bottle.max_batch_size', '250', 'int', 'Max items in one bulk transfer'],
  ['redeem.min_credits', '50', 'int', 'Minimum credits per redemption'],
  ['redeem.daily_credit_cap', '500', 'int', 'Max credits redeemable per user per day'],
  ['redeem.require_electricity_verified', 'true', 'bool', 'Bill offsets need a verified consumer number'],
  ['xp.per_credit', '1', 'int', 'XP granted per credit earned'],
  ['xp.level_curve', '[0,100,250,500,900,1500,2400,3600,5200,7200,9800]', 'json', 'Cumulative XP required per level'],
];

export const SPECIES_SEED = [
  ['neem', 'Neem', 'Azadirachta indica', '🌿', 21000, 12, 1800, 'Hardy and drought tolerant. Water twice a week for the first year.', 10],
  ['peepal', 'Peepal', 'Ficus religiosa', '🌳', 27000, 14, 3000, 'Needs open space. Keep roots clear of walls and pipes.', 20],
  ['banyan', 'Banyan', 'Ficus benghalensis', '🌳', 29000, 14, 3000, 'Very wide canopy. Plant far from buildings.', 30],
  ['mango', 'Mango', 'Mangifera indica', '🥭', 20000, 12, 2000, 'Full sun. Mulch the base to hold moisture.', 40],
  ['guava', 'Guava', 'Psidium guajava', '🍐', 15000, 10, 800, 'Prune yearly to keep it bushy and fruiting.', 50],
  ['gulmohar', 'Gulmohar', 'Delonix regia', '🌺', 18000, 11, 1200, 'Fast growing shade tree. Stake it for the first season.', 60],
  ['ashoka', 'Ashoka', 'Saraca asoca', '🌱', 14000, 10, 900, 'Prefers partial shade and steady moisture.', 70],
  ['jamun', 'Jamun', 'Syzygium cumini', '🫐', 22000, 12, 2000, 'Deep watering monthly once established.', 80],
  ['bamboo', 'Bamboo', 'Bambusa vulgaris', '🎍', 30000, 13, 1500, 'Grows fast. Contain the rhizomes so it does not spread.', 90],
  ['coconut', 'Coconut', 'Cocos nucifera', '🥥', 16000, 11, 2500, 'Sandy soil and plenty of sun. Water weekly.', 100],
  ['other', 'Other', '', '🌲', 15000, 8, 1000, 'Log the species name in the nickname field.', 999],
];

export const REWARDS_SEED = [
  ['Electricity Bill Credit ₹50', '₹50 off your next bill', 'Applied directly to your verified consumer number within 3 working days.', 'electricity_bill', 250, 50, 'State Discom', '💡', 0, 1, true, 500, 10],
  ['Electricity Bill Credit ₹100', '₹100 off your next bill', 'Applied directly to your verified consumer number within 3 working days.', 'electricity_bill', 480, 100, 'State Discom', '⚡', 0, 2, true, 300, 20],
  ['Electricity Bill Credit ₹250', '₹250 off your next bill', 'Applied directly to your verified consumer number within 5 working days.', 'electricity_bill', 1150, 250, 'State Discom', '🔌', 0, 3, true, 120, 30],
  ['Movie Ticket Voucher', 'One 2D ticket, any show', 'Redeemable at partner multiplexes. Valid 90 days from issue.', 'movie_voucher', 600, 200, 'PVR INOX', '🎬', 0, 2, false, 200, 40],
  ['Mobile Recharge ₹99', 'Any operator', 'Voucher code delivered in-app. Works with all major operators.', 'mobile_recharge', 460, 99, 'Multi-operator', '📱', 0, 1, false, 400, 50],
  ['Shopping Voucher ₹200', 'Groceries and daily needs', 'Digital gift card usable online or in store.', 'shopping_voucher', 900, 200, 'BigBasket', '🛒', 0, 2, false, 150, 60],
  ['Metro Pass Top-up ₹100', '₹100 travel balance', 'Loaded onto your metro smart card. Share the card number at checkout.', 'metro_pass', 470, 100, 'City Metro', '🚇', 0, 1, false, 250, 70],
  ['Plant a Tree in My Name', 'We plant, you get the certificate', 'Our field partner plants a sapling and shares geotagged proof.', 'tree_donation', 300, 100, 'Dhara Foundation', '🌱', 0, 1, false, 1000, 80],
];

export const BADGES_SEED = [
  ['first_sapling', 'First Sapling', 'Planted your very first tree', '🌱', 'bronze', 'trees_planted', 1, 10, 10],
  ['grove_keeper', 'Grove Keeper', 'Five trees alive and thriving', '🌿', 'silver', 'trees_alive', 5, 40, 20],
  ['forest_maker', 'Forest Maker', 'Twenty five trees alive', '🌳', 'gold', 'trees_alive', 25, 200, 30],
  ['canopy_legend', 'Canopy Legend', 'One hundred trees alive', '🏆', 'platinum', 'trees_alive', 100, 1000, 40],
  ['caretaker', 'Caretaker', 'Ten monthly check-ins completed', '📸', 'bronze', 'verifications', 10, 25, 50],
  ['devoted', 'Devoted', 'Fifty monthly check-ins completed', '🔍', 'silver', 'verifications', 50, 120, 60],
  ['bottle_saver', 'Bottle Saver', 'Returned ten items for recycling', '♻️', 'bronze', 'bottles_returned', 10, 20, 70],
  ['waste_warrior', 'Waste Warrior', 'Returned one hundred items', '🗑️', 'silver', 'bottles_returned', 100, 150, 80],
  ['circular_hero', 'Circular Hero', 'Returned five hundred items', '🌍', 'gold', 'bottles_returned', 500, 600, 90],
  ['streak_3', 'On a Roll', 'Three months in a row', '🔥', 'bronze', 'streak', 3, 30, 100],
  ['streak_6', 'Half Year Strong', 'Six months in a row', '💪', 'silver', 'streak', 6, 80, 110],
  ['streak_12', 'Year of Green', 'Twelve months in a row', '🎖️', 'gold', 'streak', 12, 250, 120],
  ['credits_500', 'Green Saver', 'Earned 500 lifetime credits', '💚', 'bronze', 'credits_lifetime', 500, 25, 130],
  ['credits_5000', 'Green Tycoon', 'Earned 5000 lifetime credits', '💎', 'gold', 'credits_lifetime', 5000, 300, 140],
  ['referrer_5', 'Community Builder', 'Five friends joined through you', '🤝', 'silver', 'referrals', 5, 100, 150],
];
