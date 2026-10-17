import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/profile.dart';
import '../../../data/models/reward.dart';
import '../../../data/models/tree.dart';
import '../../../state/auth_controller.dart';
import '../../../state/leaderboard_controller.dart';
import '../../../state/trees_controller.dart';
import '../../widgets/celebrate.dart';
import '../../widgets/common.dart';

/// Colour for a badge tier. Anything unrecognised falls back to bronze rather
/// than disappearing, since tiers are server-defined and may grow.
Color badgeTierColor(String tier) => switch (tier) {
      'silver' => AppColors.silver,
      'gold' => AppColors.gold,
      'platinum' => AppColors.platinum,
      _ => AppColors.bronze,
    };

/// The full badge catalog: earned ones in colour, the rest showing how close
/// they are.
///
/// Locked badges are deliberately visible. A hidden goal cannot motivate
/// anyone, and the progress bar is the whole point of the screen.
class BadgesScreen extends ConsumerWidget {
  const BadgesScreen({super.key});

  static Future<void> push(BuildContext context) {
    Haptics.tap();
    return Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const BadgesScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final badges = ref.watch(badgesProvider);
    final profile = ref.watch(currentProfileProvider);
    final stats = ref.watch(badgeStatsProvider);

    final all = badges.value ?? const <BadgeItem>[];
    final earned = all.where((b) => b.isEarned).length;

    return LightStatusBar(
      child: Scaffold(
        backgroundColor: AppColors.canvas,
        body: RefreshIndicator(
          onRefresh: () async => ref.invalidate(badgesProvider),
          color: AppColors.green,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: _Header(
                  earned: earned,
                  total: all.length,
                  profile: profile,
                  onSync: () => _sync(context, ref),
                ),
              ),
              ...switch (badges) {
                AsyncError(:final error) => [
                    SliverFillRemaining(
                      hasScrollBody: false,
                      child: ErrorRetry(
                        message: friendlyMessage(error),
                        onRetry: () => ref.invalidate(badgesProvider),
                      ),
                    ),
                  ],
                AsyncLoading() => const [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.only(top: 24),
                        child: LoadingList(count: 3, height: 120),
                      ),
                    ),
                  ],
                AsyncValue(:final value?) => _grid(value, stats),
              },
              const SliverToBoxAdapter(child: SizedBox(height: 40)),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _grid(List<BadgeItem> badges, BadgeStats stats) {
    if (badges.isEmpty) {
      return const [
        SliverFillRemaining(
          hasScrollBody: false,
          child: EmptyState(
            emoji: '\u{1F3C5}',
            title: 'No badges listed yet',
            message: 'New challenges are added regularly. Check back soon.',
          ),
        ),
      ];
    }

    // Earned first, then whatever is closest to unlocking: the next reachable
    // goal is more useful than catalog order.
    final sorted = [...badges]..sort((a, b) {
      if (a.isEarned != b.isEarned) return a.isEarned ? -1 : 1;
      if (a.isEarned && b.isEarned) {
        return b.earnedAt!.compareTo(a.earnedAt!);
      }
      return stats.progressOf(b).compareTo(stats.progressOf(a));
    });

    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
        sliver: SliverGrid.builder(
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            // Tall enough for the medallion, a two-line title and the progress
            // bar at the largest supported text scale.
            childAspectRatio: 0.72,
          ),
          itemCount: sorted.length,
          itemBuilder: (context, i) {
            final badge = sorted[i];
            return _BadgeTile(
              badge: badge,
              progress: stats.progressOf(badge),
            )
                .animate(delay: (i < 12 ? 40 * i : 0).ms)
                .fadeIn()
                .scale(begin: const Offset(0.9, 0.9));
          },
        ),
      ),
    ];
  }

  /// Asks the server to grant anything now qualified for.
  ///
  /// Each grant is keyed by badge code, so pressing this repeatedly cannot pay
  /// a bonus twice — which is why it is safe to expose as a button.
  Future<void> _sync(BuildContext context, WidgetRef ref) async {
    Haptics.press();

    try {
      final result = await runBlocking(
        context,
        () => ref.read(badgesControllerProvider.notifier).sync(),
        message: 'Checking your badges',
      );
      if (result == null || !context.mounted) return;

      if (!result.hasUnlocked) {
        Haptics.tap();
        showSnack(context, 'Nothing new yet. Keep going.');
        return;
      }

      final bonus = result.unlocked.fold<int>(
        0,
        (sum, b) => sum + b.bonusCredits,
      );

      await showAwardSheet(
        context,
        title: result.unlocked.length == 1
            ? '${result.unlocked.first.title} unlocked'
            : '${result.unlocked.length} badges unlocked',
        credits: bonus,
        emoji: result.unlocked.first.emoji,
        message: result.unlocked.map((b) => b.title).join(', '),
        balance: result.balance,
      );
    } catch (e) {
      if (!context.mounted) return;
      Haptics.error();
      showSnack(context, friendlyMessage(e), isError: true);
    }
  }
}

/// The stats a badge's progress is measured against.
///
/// `verifications` is summed from the loaded trees because the profile row does
/// not carry a total; `referrals` has no client-readable source at all, so a
/// locked referral badge shows no progress. Both only affect the progress bar —
/// whether a badge is actually earned is decided by the server.
class BadgeStats {
  const BadgeStats({
    required this.treesPlanted,
    required this.treesAlive,
    required this.verifications,
    required this.bottlesReturned,
    required this.streak,
    required this.creditsLifetime,
    this.referrals = 0,
  });

  final int treesPlanted;
  final int treesAlive;
  final int verifications;
  final int bottlesReturned;
  final int streak;
  final int creditsLifetime;
  final int referrals;

  double progressOf(BadgeItem badge) => badge.progressFrom(
        treesPlanted: treesPlanted,
        treesAlive: treesAlive,
        verifications: verifications,
        bottlesReturned: bottlesReturned,
        streak: streak,
        creditsLifetime: creditsLifetime,
        referrals: referrals,
      );

  /// The user's current count for whichever metric a badge tracks.
  int currentFor(BadgeItem badge) => switch (badge.metric) {
        'trees_planted' => treesPlanted,
        'trees_alive' => treesAlive,
        'verifications' => verifications,
        'bottles_returned' => bottlesReturned,
        'streak' => streak,
        'credits_lifetime' => creditsLifetime,
        'referrals' => referrals,
        _ => 0,
      };
}

final badgeStatsProvider = Provider<BadgeStats>((ref) {
  final profile = ref.watch(currentProfileProvider);
  final trees = ref.watch(treesControllerProvider).value ?? const <Tree>[];

  return BadgeStats(
    treesPlanted: profile?.treesPlanted ?? 0,
    treesAlive: profile?.treesAlive ?? 0,
    verifications: trees.fold<int>(0, (sum, t) => sum + t.verificationCount),
    bottlesReturned: profile?.bottlesReturned ?? 0,
    streak: profile?.streakCount ?? 0,
    creditsLifetime: profile?.creditsLifetime ?? 0,
  );
});

class _Header extends StatelessWidget {
  const _Header({
    required this.earned,
    required this.total,
    required this.profile,
    required this.onSync,
  });

  final int earned;
  final int total;
  final Profile? profile;
  final VoidCallback onSync;

  @override
  Widget build(BuildContext context) {
    return GradientHeader(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () {
                  Haptics.tap();
                  Navigator.of(context).maybePop();
                },
                icon: const Icon(Icons.arrow_back_rounded),
                color: Colors.white,
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Badges',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              IconButton(
                onPressed: onSync,
                icon: const Icon(Icons.autorenew_rounded),
                color: AppColors.lime,
                tooltip: 'Check for new badges',
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              ProgressRing(
                progress: total == 0 ? 0 : earned / total,
                size: 66,
                thickness: 7,
                color: AppColors.lime,
                track: Colors.white24,
                child: Text(
                  '$earned',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      total == 0
                          ? 'No badges yet'
                          : '$earned of $total earned',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      profile == null
                          ? 'Badges pay a one-off credit bonus.'
                          : 'Level ${profile!.level} \u00B7 '
                              '${profile!.levelTitle}',
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    ).animate().fadeIn(duration: 320.ms);
  }
}

class _BadgeTile extends StatelessWidget {
  const _BadgeTile({required this.badge, required this.progress});

  final BadgeItem badge;
  final double progress;

  @override
  Widget build(BuildContext context) {
    final earned = badge.isEarned;
    final tint = badgeTierColor(badge.tier);

    return DharaCard(
      onTap: () => showBadgeSheet(context, badge, progress),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      radius: 18,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: earned
                  ? tint.withValues(alpha: 0.18)
                  : AppColors.surfaceMuted,
              shape: BoxShape.circle,
              border: Border.all(
                color: earned ? tint : AppColors.outline,
                width: 1.6,
              ),
            ),
            child: Center(
              child: earned
                  ? Text(badge.emoji, style: const TextStyle(fontSize: 22))
                  : const Icon(
                      Icons.lock_outline_rounded,
                      size: 19,
                      color: AppColors.inkFaint,
                    ),
            ),
          ),
          const SizedBox(height: 8),
          Flexible(
            child: Text(
              badge.title,
              maxLines: 2,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                height: 1.2,
                fontWeight: FontWeight.w800,
                color: earned ? AppColors.forest : AppColors.inkSoft,
              ),
            ),
          ),
          const SizedBox(height: 6),
          if (earned)
            Text(
              badge.tier.toUpperCase(),
              style: TextStyle(
                fontSize: 8.5,
                letterSpacing: 0.6,
                fontWeight: FontWeight.w900,
                color: tint,
              ),
            )
          else
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 4,
                backgroundColor: AppColors.surfaceMuted,
                valueColor: const AlwaysStoppedAnimation(AppColors.sage),
              ),
            ),
        ],
      ),
    );
  }
}

/// Detail for one badge: what it takes, how close you are, what it pays.
Future<void> showBadgeSheet(
  BuildContext context,
  BadgeItem badge,
  double progress,
) {
  Haptics.tap();

  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (_) => _BadgeSheet(badge: badge, progress: progress),
  );
}

class _BadgeSheet extends ConsumerWidget {
  const _BadgeSheet({required this.badge, required this.progress});

  final BadgeItem badge;
  final double progress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final earned = badge.isEarned;
    final tint = badgeTierColor(badge.tier);
    final current = ref.watch(badgeStatsProvider).currentFor(badge);
    // Not `clamp`, which throws when the bounds invert on a zero threshold.
    final remaining = badge.threshold > current ? badge.threshold - current : 0;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Container(
          padding: const EdgeInsets.fromLTRB(22, 26, 22, 20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(28),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ProgressRing(
                progress: earned ? 1 : progress,
                size: 88,
                thickness: 7,
                color: earned ? tint : AppColors.sage,
                child: Text(
                  badge.emoji,
                  style: TextStyle(
                    fontSize: 32,
                    // Locked badges are dimmed rather than hidden, so the goal
                    // still reads as a thing worth wanting.
                    color: earned ? null : AppColors.inkFaint,
                  ),
                ),
              )
                  .animate()
                  .scale(duration: 460.ms, curve: Curves.easeOutBack)
                  .fadeIn(),
              const SizedBox(height: 18),
              Text(
                badge.title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: AppColors.forest,
                ),
              ),
              const SizedBox(height: 6),
              StatusPill(
                label: badge.tier.toUpperCase(),
                color: tint,
                compact: true,
              ),
              if (badge.description.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  badge.description,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12.5,
                    height: 1.5,
                    fontWeight: FontWeight.w500,
                    color: AppColors.inkSoft,
                  ),
                ),
              ],
              const SizedBox(height: 18),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surfaceMuted,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Column(
                  children: [
                    _SheetLine(
                      label: 'Goal',
                      value: '${badge.threshold} '
                          '${_metricLabel(badge.metric, badge.threshold)}',
                    ),
                    if (!earned) ...[
                      const SizedBox(height: 9),
                      _SheetLine(
                        label: 'You have',
                        value: '$current',
                      ),
                      const SizedBox(height: 9),
                      _SheetLine(
                        label: 'To go',
                        value: '$remaining',
                      ),
                    ],
                    if (badge.bonusCredits > 0) ...[
                      const SizedBox(height: 9),
                      _SheetLine(
                        label: earned ? 'Bonus paid' : 'Bonus',
                        value: '${badge.bonusCredits} credits',
                      ),
                    ],
                    if (earned) ...[
                      const SizedBox(height: 9),
                      _SheetLine(
                        label: 'Earned',
                        value: DateFormat('d MMM yyyy').format(badge.earnedAt!),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    Haptics.tap();
                    Navigator.of(context).pop();
                  },
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(50),
                  ),
                  child: Text(earned ? 'Nice' : 'Got it'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _metricLabel(String metric, int count) {
    final one = count == 1;
    return switch (metric) {
      'trees_planted' => one ? 'tree planted' : 'trees planted',
      'trees_alive' => one ? 'tree kept alive' : 'trees kept alive',
      'verifications' => one ? 'check-in' : 'check-ins',
      'bottles_returned' => one ? 'item returned' : 'items returned',
      'streak' => one ? 'month in a row' : 'months in a row',
      'credits_lifetime' => 'credits earned',
      'referrals' => one ? 'friend invited' : 'friends invited',
      _ => 'to go',
    };
  }
}

class _SheetLine extends StatelessWidget {
  const _SheetLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: AppColors.inkSoft,
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.forest,
            ),
          ),
        ),
      ],
    );
  }
}
