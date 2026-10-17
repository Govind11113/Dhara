import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/services/api.dart';
import '../data/models/reward.dart';
import '../data/repository.dart';
import 'auth_controller.dart';

/// Which board is being shown. These strings are the values the server accepts.
enum LeaderboardPeriod {
  allTime('all_time', 'All time'),
  monthly('monthly', 'This month');

  const LeaderboardPeriod(this.wire, this.label);
  final String wire;
  final String label;
}

/// Holds the selected board.
///
/// A plain [Notifier] rather than `StateProvider`, which Riverpod 3 has moved
/// to `legacy.dart` — the rest of the app is on the modern notifier API.
class LeaderboardPeriodController extends Notifier<LeaderboardPeriod> {
  @override
  LeaderboardPeriod build() => LeaderboardPeriod.allTime;

  void select(LeaderboardPeriod period) => state = period;
}

final leaderboardPeriodProvider =
    NotifierProvider<LeaderboardPeriodController, LeaderboardPeriod>(
  LeaderboardPeriodController.new,
);

/// Ranked members for the selected period.
///
/// `profiles` is readable only by its owner, so ranking cannot be computed on
/// the client. The server publishes a snapshot containing just the public
/// fields; this asks it to refresh (a no-op if the snapshot is already fresh)
/// and then reads the result.
final leaderboardProvider =
    FutureProvider<List<LeaderboardEntry>>((ref) async {
  final period = ref.watch(leaderboardPeriodProvider);
  final repo = ref.watch(repositoryProvider);

  try {
    await ref.read(apiProvider).refreshLeaderboard(period: period.wire);
  } catch (_) {
    // A refresh failure is not fatal: showing a slightly stale board beats
    // showing an error screen.
  }

  return repo.leaderboard(period: period.wire);
});

/// Where the signed-in user sits on the current board, if they are ranked.
final myRankProvider = Provider<LeaderboardEntry?>((ref) {
  final userId = ref.watch(currentUserIdProvider);
  if (userId == null) return null;
  final entries = ref.watch(leaderboardProvider).value;
  if (entries == null) return null;
  for (final entry in entries) {
    if (entry.userId == userId) return entry;
  }
  return null;
});

/// The badge catalog joined with what the user has earned, so locked badges
/// still appear with live progress.
final badgesProvider = FutureProvider<List<BadgeItem>>((ref) async {
  final userId = ref.watch(currentUserIdProvider);
  if (userId == null) return const [];
  return ref.watch(repositoryProvider).badges(userId);
});

final earnedBadgesProvider = Provider<List<BadgeItem>>((ref) {
  final badges = ref.watch(badgesProvider).value ?? const <BadgeItem>[];
  return badges.where((b) => b.isEarned).toList(growable: false);
});

class BadgeSyncResult {
  const BadgeSyncResult({this.unlocked = const [], this.balance});

  /// Newly unlocked badges, worth celebrating in the UI.
  final List<BadgeItem> unlocked;
  final int? balance;

  bool get hasUnlocked => unlocked.isNotEmpty;
}

class BadgesController extends Notifier<void> {
  @override
  void build() {}

  /// Asks the server to grant any badges now qualified for.
  ///
  /// Safe to call after any credit-earning action: each grant is keyed by badge
  /// code, so a repeated sync cannot pay a bonus twice.
  Future<BadgeSyncResult> sync() async {
    final data = await ref.read(apiProvider).syncBadges();

    final raw = data['unlocked'];
    final unlocked = raw is List
        ? raw
            .whereType<Map<String, dynamic>>()
            .map((m) => BadgeItem.fromMap(m, earnedAt: DateTime.now()))
            .toList()
        : const <BadgeItem>[];

    if (unlocked.isNotEmpty) {
      ref.invalidate(badgesProvider);
      await ref.read(authControllerProvider.notifier).refreshProfile();
    }

    return BadgeSyncResult(
      unlocked: unlocked,
      balance: data['balance'] is num ? (data['balance'] as num).round() : null,
    );
  }
}

final badgesControllerProvider =
    NotifierProvider<BadgesController, void>(BadgesController.new);
