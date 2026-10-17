import 'package:equatable/equatable.dart';

/// Level thresholds mirror `xp.level_curve` in app_config.
const kLevelCurve = <int>[0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7200, 9800];

class Profile extends Equatable {
  const Profile({
    required this.id,
    required this.userId,
    required this.name,
    required this.email,
    this.phone,
    this.avatarFileId,
    this.referralCode,
    this.referredBy,
    this.creditsAvailable = 0,
    this.creditsLifetime = 0,
    this.creditsPending = 0,
    this.creditsSpent = 0,
    this.xp = 0,
    this.level = 1,
    this.treesPlanted = 0,
    this.treesAlive = 0,
    this.bottlesReturned = 0,
    this.co2OffsetGrams = 0,
    this.streakCount = 0,
    this.longestStreak = 0,
    this.lastVerifyAt,
    this.trustScore = 100,
    this.isBanned = false,
    this.banReason,
    this.electricityVerified = false,
    this.primaryConsumerNo,
  });

  final String id;
  final String userId;
  final String name;
  final String email;
  final String? phone;
  final String? avatarFileId;
  final String? referralCode;
  final String? referredBy;

  final int creditsAvailable;
  final int creditsLifetime;
  final int creditsPending;
  final int creditsSpent;

  final int xp;
  final int level;
  final int treesPlanted;
  final int treesAlive;
  final int bottlesReturned;
  final int co2OffsetGrams;
  final int streakCount;
  final int longestStreak;
  final DateTime? lastVerifyAt;

  final int trustScore;
  final bool isBanned;
  final String? banReason;
  final bool electricityVerified;
  final String? primaryConsumerNo;

  factory Profile.fromMap(Map<String, dynamic> m) => Profile(
        id: (m[r'$id'] ?? '') as String,
        userId: (m['userId'] ?? '') as String,
        name: (m['name'] ?? '') as String,
        email: (m['email'] ?? '') as String,
        phone: m['phone'] as String?,
        avatarFileId: m['avatarFileId'] as String?,
        referralCode: m['referralCode'] as String?,
        referredBy: m['referredBy'] as String?,
        creditsAvailable: _int(m['creditsAvailable']),
        creditsLifetime: _int(m['creditsLifetime']),
        creditsPending: _int(m['creditsPending']),
        creditsSpent: _int(m['creditsSpent']),
        xp: _int(m['xp']),
        level: _int(m['level'], 1),
        treesPlanted: _int(m['treesPlanted']),
        treesAlive: _int(m['treesAlive']),
        bottlesReturned: _int(m['bottlesReturned']),
        co2OffsetGrams: _int(m['co2OffsetGrams']),
        streakCount: _int(m['streakCount']),
        longestStreak: _int(m['longestStreak']),
        lastVerifyAt: _date(m['lastVerifyAt']),
        trustScore: _int(m['trustScore'], 100),
        isBanned: m['isBanned'] == true,
        banReason: m['banReason'] as String?,
        electricityVerified: m['electricityVerified'] == true,
        primaryConsumerNo: m['primaryConsumerNo'] as String?,
      );

  /// XP still needed to reach the next level, and progress through the
  /// current one. Past the end of the curve we treat the user as maxed.
  int get xpForNextLevel {
    if (level >= kLevelCurve.length) return xp;
    return kLevelCurve[level];
  }

  int get xpAtLevelStart {
    final i = (level - 1).clamp(0, kLevelCurve.length - 1);
    return kLevelCurve[i];
  }

  double get levelProgress {
    if (level >= kLevelCurve.length) return 1;
    final span = xpForNextLevel - xpAtLevelStart;
    if (span <= 0) return 1;
    return ((xp - xpAtLevelStart) / span).clamp(0.0, 1.0);
  }

  bool get isMaxLevel => level >= kLevelCurve.length;

  String get levelTitle => switch (level) {
        1 => 'Seedling',
        2 => 'Sprout',
        3 => 'Sapling',
        4 => 'Young Tree',
        5 => 'Grove Keeper',
        6 => 'Woodland Guide',
        7 => 'Forest Friend',
        8 => 'Canopy Guard',
        9 => 'Earth Steward',
        10 => 'Green Legend',
        _ => 'Dhara Champion',
      };

  Profile copyWith({
    int? creditsAvailable,
    int? creditsLifetime,
    int? creditsPending,
    int? treesPlanted,
    int? treesAlive,
    int? bottlesReturned,
    int? co2OffsetGrams,
    int? streakCount,
    int? xp,
    int? level,
    bool? electricityVerified,
    String? primaryConsumerNo,
    String? name,
    String? avatarFileId,
  }) =>
      Profile(
        id: id,
        userId: userId,
        name: name ?? this.name,
        email: email,
        phone: phone,
        avatarFileId: avatarFileId ?? this.avatarFileId,
        referralCode: referralCode,
        referredBy: referredBy,
        creditsAvailable: creditsAvailable ?? this.creditsAvailable,
        creditsLifetime: creditsLifetime ?? this.creditsLifetime,
        creditsPending: creditsPending ?? this.creditsPending,
        creditsSpent: creditsSpent,
        xp: xp ?? this.xp,
        level: level ?? this.level,
        treesPlanted: treesPlanted ?? this.treesPlanted,
        treesAlive: treesAlive ?? this.treesAlive,
        bottlesReturned: bottlesReturned ?? this.bottlesReturned,
        co2OffsetGrams: co2OffsetGrams ?? this.co2OffsetGrams,
        streakCount: streakCount ?? this.streakCount,
        longestStreak: longestStreak,
        lastVerifyAt: lastVerifyAt,
        trustScore: trustScore,
        isBanned: isBanned,
        banReason: banReason,
        electricityVerified: electricityVerified ?? this.electricityVerified,
        primaryConsumerNo: primaryConsumerNo ?? this.primaryConsumerNo,
      );

  @override
  List<Object?> get props => [
        id,
        creditsAvailable,
        creditsLifetime,
        creditsPending,
        xp,
        level,
        treesPlanted,
        treesAlive,
        bottlesReturned,
        co2OffsetGrams,
        streakCount,
        electricityVerified,
        name,
        avatarFileId,
        trustScore,
      ];
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
