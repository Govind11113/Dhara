import 'package:equatable/equatable.dart';

enum RewardType {
  electricityBill('electricity_bill', 'Electricity bill', '\u{1F4A1}'),
  movieVoucher('movie_voucher', 'Movies', '\u{1F3AC}'),
  mobileRecharge('mobile_recharge', 'Recharge', '\u{1F4F1}'),
  shoppingVoucher('shopping_voucher', 'Shopping', '\u{1F6D2}'),
  metroPass('metro_pass', 'Travel', '\u{1F687}'),
  treeDonation('tree_donation', 'Give back', '\u{1F331}'),
  cashTransfer('cash_transfer', 'Cash', '\u{1F4B0}');

  const RewardType(this.wire, this.label, this.emoji);
  final String wire;
  final String label;
  final String emoji;

  static RewardType parse(Object? v) => RewardType.values.firstWhere(
        (r) => r.wire == v,
        orElse: () => RewardType.shoppingVoucher,
      );
}

class Reward extends Equatable {
  const Reward({
    required this.id,
    required this.title,
    required this.type,
    required this.creditsCost,
    this.subtitle = '',
    this.description = '',
    this.faceValueInr = 0,
    this.partner = '',
    this.emoji = '',
    this.stockRemaining = 0,
    this.minLevel = 1,
    this.requiresElectricityAccount = false,
    this.isActive = true,
  });

  final String id;
  final String title;
  final RewardType type;
  final int creditsCost;
  final String subtitle;
  final String description;
  final int faceValueInr;
  final String partner;
  final String emoji;
  final int stockRemaining;
  final int minLevel;
  final bool requiresElectricityAccount;
  final bool isActive;

  factory Reward.fromMap(Map<String, dynamic> m) => Reward(
        id: (m[r'$id'] ?? '') as String,
        title: (m['title'] ?? '') as String,
        type: RewardType.parse(m['type']),
        creditsCost: _int(m['creditsCost'], 100),
        subtitle: (m['subtitle'] ?? '') as String,
        description: (m['description'] ?? '') as String,
        faceValueInr: _int(m['faceValueInr']),
        partner: (m['partner'] ?? '') as String,
        emoji: (m['emoji'] ?? '') as String,
        stockRemaining: _int(m['stockRemaining']),
        minLevel: _int(m['minLevel'], 1),
        requiresElectricityAccount: m['requiresElectricityAccount'] == true,
        isActive: m['isActive'] != false,
      );

  String get icon => emoji.isNotEmpty ? emoji : type.emoji;

  bool get inStock => stockRemaining > 0;

  /// Everything blocking redemption right now, in the order worth surfacing.
  String? blockedReason({
    required int availableCredits,
    required int level,
    required bool electricityVerified,
  }) {
    if (!isActive) return 'Not available right now';
    if (!inStock) return 'Out of stock';
    if (level < minLevel) return 'Unlocks at level $minLevel';
    if (requiresElectricityAccount && !electricityVerified) {
      return 'Verify your electricity account first';
    }
    if (availableCredits < creditsCost) {
      return '${creditsCost - availableCredits} more credits needed';
    }
    return null;
  }

  @override
  List<Object?> get props => [id, creditsCost, stockRemaining, isActive];
}

enum RedemptionStatus {
  pending('pending', 'Pending'),
  processing('processing', 'Processing'),
  fulfilled('fulfilled', 'Delivered'),
  failed('failed', 'Failed'),
  cancelled('cancelled', 'Cancelled');

  const RedemptionStatus(this.wire, this.label);
  final String wire;
  final String label;

  static RedemptionStatus parse(Object? v) =>
      RedemptionStatus.values.firstWhere(
        (s) => s.wire == v,
        orElse: () => RedemptionStatus.pending,
      );

  bool get isOpen =>
      this == RedemptionStatus.pending || this == RedemptionStatus.processing;
}

class Redemption extends Equatable {
  const Redemption({
    required this.id,
    required this.rewardTitle,
    required this.type,
    required this.creditsSpent,
    required this.status,
    required this.requestedAt,
    this.faceValueInr = 0,
    this.voucherCode,
    this.failureReason,
    this.fulfilledAt,
  });

  final String id;
  final String rewardTitle;
  final RewardType type;
  final int creditsSpent;
  final RedemptionStatus status;
  final DateTime requestedAt;
  final int faceValueInr;
  final String? voucherCode;
  final String? failureReason;
  final DateTime? fulfilledAt;

  factory Redemption.fromMap(Map<String, dynamic> m) => Redemption(
        id: (m[r'$id'] ?? '') as String,
        rewardTitle: (m['rewardTitle'] ?? '') as String,
        type: RewardType.parse(m['type']),
        creditsSpent: _int(m['creditsSpent']),
        status: RedemptionStatus.parse(m['status']),
        requestedAt: _date(m['requestedAt']) ?? DateTime.now(),
        faceValueInr: _int(m['faceValueInr']),
        voucherCode: m['voucherCode'] as String?,
        failureReason: m['failureReason'] as String?,
        fulfilledAt: _date(m['fulfilledAt']),
      );

  @override
  List<Object?> get props => [id, status, voucherCode];
}

class CreditEntry extends Equatable {
  const CreditEntry({
    required this.id,
    required this.delta,
    required this.source,
    required this.occurredAt,
    this.balanceAfter = 0,
    this.note = '',
  });

  final String id;
  final int delta;
  final String source;
  final DateTime occurredAt;
  final int balanceAfter;
  final String note;

  factory CreditEntry.fromMap(Map<String, dynamic> m) => CreditEntry(
        id: (m[r'$id'] ?? '') as String,
        delta: _int(m['delta']),
        source: (m['source'] ?? '') as String,
        occurredAt: _date(m['occurredAt']) ?? DateTime.now(),
        balanceAfter: _int(m['balanceAfter']),
        note: (m['note'] ?? '') as String,
      );

  bool get isCredit => delta >= 0;

  String get label => switch (source) {
        'tree_plant' => 'Tree planted',
        'tree_verify' => 'Monthly check-in',
        'tree_vesting' => 'Tree vesting bonus',
        'bottle_return' => 'Packaging returned',
        'referral' => 'Referral bonus',
        'streak_bonus' => 'Streak bonus',
        'badge_bonus' => 'Badge unlocked',
        'redemption' => 'Redeemed',
        'reversal' => 'Reversed',
        'admin_adjustment' => 'Adjustment',
        _ => 'Credits',
      };

  String get emoji => switch (source) {
        'tree_plant' => '\u{1F331}',
        'tree_verify' => '\u{1F4F8}',
        'tree_vesting' => '\u{1F333}',
        'bottle_return' => '\u{267B}',
        'referral' => '\u{1F91D}',
        'streak_bonus' => '\u{1F525}',
        'badge_bonus' => '\u{1F3C5}',
        'redemption' => '\u{1F381}',
        'reversal' => '\u{21A9}',
        _ => '\u{1F4B3}',
      };

  @override
  List<Object?> get props => [id, delta, occurredAt];
}

class BadgeItem extends Equatable {
  const BadgeItem({
    required this.code,
    required this.title,
    required this.tier,
    required this.metric,
    required this.threshold,
    this.description = '',
    this.emoji = '\u{1F3C5}',
    this.bonusCredits = 0,
    this.earnedAt,
  });

  final String code;
  final String title;
  final String tier;
  final String metric;
  final int threshold;
  final String description;
  final String emoji;
  final int bonusCredits;
  final DateTime? earnedAt;

  bool get isEarned => earnedAt != null;

  factory BadgeItem.fromMap(Map<String, dynamic> m, {DateTime? earnedAt}) =>
      BadgeItem(
        code: (m['code'] ?? '') as String,
        title: (m['title'] ?? '') as String,
        tier: (m['tier'] ?? 'bronze') as String,
        metric: (m['metric'] ?? '') as String,
        threshold: _int(m['threshold'], 1),
        description: (m['description'] ?? '') as String,
        emoji: (m['emoji'] ?? '\u{1F3C5}') as String,
        bonusCredits: _int(m['bonusCredits']),
        earnedAt: earnedAt,
      );

  BadgeItem markEarned(DateTime when) => BadgeItem(
        code: code,
        title: title,
        tier: tier,
        metric: metric,
        threshold: threshold,
        description: description,
        emoji: emoji,
        bonusCredits: bonusCredits,
        earnedAt: when,
      );

  /// Progress toward the threshold using the user's current stats.
  double progressFrom({
    required int treesPlanted,
    required int treesAlive,
    required int verifications,
    required int bottlesReturned,
    required int streak,
    required int creditsLifetime,
    required int referrals,
  }) {
    final current = switch (metric) {
      'trees_planted' => treesPlanted,
      'trees_alive' => treesAlive,
      'verifications' => verifications,
      'bottles_returned' => bottlesReturned,
      'streak' => streak,
      'credits_lifetime' => creditsLifetime,
      'referrals' => referrals,
      _ => 0,
    };
    if (threshold <= 0) return 1;
    return (current / threshold).clamp(0.0, 1.0);
  }

  @override
  List<Object?> get props => [code, earnedAt];
}

class LeaderboardEntry extends Equatable {
  const LeaderboardEntry({
    required this.userId,
    required this.name,
    required this.rank,
    required this.score,
    this.treesAlive = 0,
    this.bottlesReturned = 0,
    this.level = 1,
    this.streakCount = 0,
    this.avatarFileId,
  });

  final String userId;
  final String name;
  final int rank;
  final int score;
  final int treesAlive;
  final int bottlesReturned;
  final int level;
  final int streakCount;
  final String? avatarFileId;

  factory LeaderboardEntry.fromMap(Map<String, dynamic> m) => LeaderboardEntry(
        userId: (m['userId'] ?? '') as String,
        name: (m['name'] ?? 'Anonymous') as String,
        rank: _int(m['rank']),
        score: _int(m['score']),
        treesAlive: _int(m['treesAlive']),
        bottlesReturned: _int(m['bottlesReturned']),
        level: _int(m['level'], 1),
        streakCount: _int(m['streakCount']),
        avatarFileId: m['avatarFileId'] as String?,
      );

  /// Derived directly from a profile row when no snapshot exists yet.
  factory LeaderboardEntry.fromProfile(Map<String, dynamic> m, int rank) =>
      LeaderboardEntry(
        userId: (m['userId'] ?? '') as String,
        name: (m['name'] ?? 'Anonymous') as String,
        rank: rank,
        score: _int(m['creditsLifetime']),
        treesAlive: _int(m['treesAlive']),
        bottlesReturned: _int(m['bottlesReturned']),
        level: _int(m['level'], 1),
        streakCount: _int(m['streakCount']),
        avatarFileId: m['avatarFileId'] as String?,
      );

  @override
  List<Object?> get props => [userId, rank, score];
}

int _int(Object? v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is String) return int.tryParse(v) ?? fallback;
  return fallback;
}

DateTime? _date(Object? v) {
  if (v is String && v.isNotEmpty) return DateTime.tryParse(v);
  return null;
}
