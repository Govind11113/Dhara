/** Shapes returned by the `api` function's /admin/ routes. */

export interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface Doc {
  $id: string;
  $createdAt: string;
  $updatedAt?: string;
}

export interface Stats {
  users: { total: number; banned: number };
  trees: { total: number; byStatus: Record<string, number> };
  verifications: { total: number; byStatus: Record<string, number> };
  credits: { lifetimeIssued: number; spent: number; sampled: number; approximate: boolean };
  co2: { offsetGrams: number; sampled: number; approximate: boolean };
  queue: { trees: number; verifications: number };
  open: { flags: number; feedback: number; redemptions: number };
  ai: AiStats;
}

export interface AiStats {
  windowDays: number;
  total: number;
  approve: number;
  review: number;
  reject: number;
  unavailable: number;
  avgLatencyMs: number;
  byModel: Record<string, { calls: number; unavailable: number; avgLatencyMs: number }>;
  enabled: boolean;
  model: string;
  onUnavailable: 'approve' | 'review';
}

export interface QueueItem {
  kind: 'tree' | 'verification';
  id: string;
  createdAt: string;
  userId: string;
  userName: string;
  userEmail: string;
  trustScore: number | null;
  isBanned: boolean;
  title: string;
  treeId?: string;
  photoFileId?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  addressLabel?: string;
  distanceM?: number;
  heightCm?: number;
  reason?: string;
  aiVerdict?: string;
  aiConfidence?: number;
  aiModel?: string;
}

export interface QueueResult {
  items: QueueItem[];
  counts: { trees: number; verifications: number };
}

export interface Profile extends Doc {
  userId: string;
  name: string;
  email: string;
  creditsAvailable: number;
  creditsLifetime: number;
  creditsSpent: number;
  xp: number;
  level: number;
  treesPlanted: number;
  treesAlive: number;
  streakCount: number;
  trustScore: number;
  isBanned: boolean;
  banReason?: string;
  lastActiveAt?: string;
}

export interface Tree extends Doc {
  ownerId: string;
  speciesName: string;
  nickname?: string;
  status: string;
  lat: number;
  lng: number;
  addressLabel?: string;
  plantPhotoFileId?: string;
  verificationCount: number;
  vestingMonths?: number;
  creditsVested: number;
  plantedAt: string;
  rejectReason?: string;
  aiVerdict?: string;
  aiConfidence?: number;
  aiModel?: string;
}

export interface Verification extends Doc {
  treeId: string;
  userId: string;
  monthKey: string;
  status: string;
  photoFileId?: string;
  distanceM: number;
  creditsAwarded: number;
  rejectReason?: string;
  aiVerdict?: string;
  aiConfidence?: number;
  verifiedAt: string;
}

export interface Flag extends Doc {
  userId: string;
  kind: string;
  severity: string;
  detail?: string;
  refType?: string;
  refId?: string;
  trustScoreDelta: number;
  resolved: boolean;
  resolution?: string;
  createdAt: string;
}

export interface Feedback extends Doc {
  userId: string;
  category: string;
  message: string;
  screenshotFileId?: string;
  refType?: string;
  refId?: string;
  appVersion?: string;
  platform?: string;
  deviceModel?: string;
  status: string;
  adminReply?: string;
  createdAt: string;
}

export interface Redemption extends Doc {
  userId: string;
  rewardTitle: string;
  type: string;
  creditsSpent: number;
  faceValueInr: number;
  status: string;
  voucherCode?: string;
  failureReason?: string;
  requestedAt: string;
}

export interface Inspection extends Doc {
  userId: string;
  refType?: string;
  refId?: string;
  provider: string;
  model: string;
  latencyMs: number;
  attempts: number;
  status: string;
  error?: string;
  action: string;
  confidence: number;
  verdict?: string;
  createdAt: string;
}

export interface AdminAction extends Doc {
  adminId: string;
  adminEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
  createdAt: string;
}

export interface ConfigSpec {
  type: 'bool' | 'int' | 'float' | 'enum' | 'string';
  min?: number;
  max?: number;
  options?: string[];
  label: string;
}

export interface ConfigItem {
  key: string;
  value: string;
  description?: string;
  spec: ConfigSpec;
}

export interface PhotoResult {
  dataUrl: string;
  mime: string;
  bytes: number;
}

export interface ReportSeriesPoint {
  month: string;
  treesPlanted: number;
  checkins: number;
  newMembers: number;
  co2CreditedGrams: number;
}

export type FootprintReport =
  | { available: false; minMembers: number }
  | {
      available: true;
      minMembers: number;
      members: number;
      avgMonthKg: number;
      medianMonthKg: number;
      avgYearKg: number;
      groups: { electricity: number; cooking: number; transport: number; air: number };
      trend: { month: string; avgMonthKg: number | null }[];
    };

export interface Report {
  generatedAt: string;
  months: string[];
  capped: { trees: boolean; verifications: boolean; profiles: boolean; footprints: boolean };
  totals: {
    members: number;
    trees: number;
    livingTrees: number;
    acceptedTrees: number;
    survivalRate: number | null;
    approvedCheckins: number;
    co2CreditedGrams: number;
    creditsIssued: number;
    creditsSpent: number;
  };
  byStatus: Record<string, number>;
  series: ReportSeriesPoint[];
  bySpecies: { code: string; name: string; trees: number; alive: number }[];
  byCity: { city: string; trees: number }[];
  footprint: FootprintReport;
}
