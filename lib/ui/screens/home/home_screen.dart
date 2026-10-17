import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/item.dart';
import '../../../data/models/profile.dart';
import '../../../data/models/reward.dart';
import '../../../data/models/tree.dart';
import '../../../state/auth_controller.dart';
import '../../../state/items_controller.dart';
import '../../../state/leaderboard_controller.dart';
import '../../../state/trees_controller.dart';
import '../../widgets/climate_cards.dart';
import '../../widgets/common.dart';
import 'dashboard_shell.dart';

/// The landing tab: balance, what needs doing today, impact, and standing.
///
/// Ordered by urgency rather than by module, so a check-in whose window is
/// about to close is the first thing on screen.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({
    super.key,
    required this.onSeeAllTrees,
    required this.onScan,
  });

  final VoidCallback onSeeAllTrees;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(currentProfileProvider);
    final due = ref.watch(treesDueProvider);
    final returnable = ref.watch(returnableItemsProvider);
    final trees = ref.watch(treesControllerProvider);

    return LightStatusBar(
      child: Scaffold(
        backgroundColor: AppColors.canvas,
        body: RefreshIndicator(
          onRefresh: () => refreshDashboard(ref),
          color: AppColors.green,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(child: _Header(profile: profile)),

              if (due.isNotEmpty)
                SliverToBoxAdapter(
                  child: _DueSection(trees: due, onOpen: onSeeAllTrees),
                ),

              if (returnable.isNotEmpty)
                SliverToBoxAdapter(
                  child: _ReturnSection(items: returnable, onScan: onScan),
                ),

              SliverToBoxAdapter(
                child: _QuickActions(
                  onPlant: onSeeAllTrees,
                  onScan: onScan,
                ),
              ),

              if (profile != null)
                SliverToBoxAdapter(child: _ImpactGrid(profile: profile)),

              const SliverToBoxAdapter(child: AirQualityCard()),
              const SliverToBoxAdapter(child: FootprintCard()),
              const SliverToBoxAdapter(child: AverageTreeCard()),

              // A brand-new account has nothing to show above, so point it at a
              // first action instead of a page of zeroes.
              if (profile != null &&
                  profile.treesPlanted == 0 &&
                  profile.bottlesReturned == 0 &&
                  !trees.isLoading)
                SliverToBoxAdapter(
                  child: _FirstStep(onPlant: onSeeAllTrees, onScan: onScan),
                ),

              const SliverToBoxAdapter(child: _StandingSection()),

              const SliverToBoxAdapter(child: SizedBox(height: 110)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.profile});

  final Profile? profile;

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final name = (profile?.name ?? '').trim();
    final firstName = name.isEmpty ? 'there' : name.split(' ').first;

    return GradientHeader(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _greeting,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      firstName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 23,
                        fontWeight: FontWeight.w800,
                        height: 1.15,
                      ),
                    ),
                  ],
                ),
              ),
              if (profile != null && profile!.streakCount > 0)
                _StreakChip(count: profile!.streakCount),
            ],
          ),
          const SizedBox(height: 20),
          _BalanceCard(profile: profile),
        ],
      ),
    ).animate().fadeIn(duration: 350.ms);
  }
}

class _StreakChip extends StatelessWidget {
  const _StreakChip({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('\u{1F525}', style: TextStyle(fontSize: 14)),
          const SizedBox(width: 5),
          Text(
            '$count mo',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    )
        .animate(delay: 200.ms)
        .scale(duration: 400.ms, curve: Curves.easeOutBack)
        .fadeIn();
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.profile});

  final Profile? profile;

  @override
  Widget build(BuildContext context) {
    final p = profile;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Available credits',
            style: TextStyle(
              color: Colors.white70,
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.2,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              AnimatedCounter(
                value: p?.creditsAvailable ?? 0,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 40,
                  fontWeight: FontWeight.w900,
                  height: 1,
                ),
              ),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  'credits',
                  style: TextStyle(
                    color: AppColors.limeSoft.withValues(alpha: 0.9),
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          if (p != null && p.creditsPending > 0) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(
                  Icons.hourglass_bottom_rounded,
                  size: 13,
                  color: Colors.white54,
                ),
                const SizedBox(width: 5),
                Text(
                  '${p.creditsPending} vesting as your trees survive',
                  style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ],
          if (p != null) ...[
            const SizedBox(height: 18),
            _LevelBar(profile: p),
          ],
        ],
      ),
    );
  }
}

class _LevelBar extends StatelessWidget {
  const _LevelBar({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    final span = profile.xpForNextLevel - profile.xpAtLevelStart;
    final into = profile.xp - profile.xpAtLevelStart;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppColors.lime,
                borderRadius: BorderRadius.circular(7),
              ),
              child: Text(
                'LV ${profile.level}',
                style: const TextStyle(
                  color: AppColors.forest,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.3,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                profile.levelTitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Text(
              profile.isMaxLevel ? 'Max' : '$into / $span XP',
              style: const TextStyle(
                color: Colors.white54,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        const SizedBox(height: 9),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: TweenAnimationBuilder<double>(
            tween: Tween<double>(begin: 0, end: profile.levelProgress),
            duration: const Duration(milliseconds: 900),
            curve: Curves.easeOutCubic,
            builder: (context, value, _) => LinearProgressIndicator(
              value: value,
              minHeight: 7,
              backgroundColor: Colors.white.withValues(alpha: 0.18),
              valueColor: const AlwaysStoppedAnimation(AppColors.lime),
            ),
          ),
        ),
      ],
    );
  }
}

class _DueSection extends StatelessWidget {
  const _DueSection({required this.trees, required this.onOpen});

  final List<Tree> trees;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: trees.length == 1
              ? '1 tree needs a check-in'
              : '${trees.length} trees need a check-in',
          action: trees.length > 2 ? 'See all' : null,
          onAction: trees.length > 2 ? onOpen : null,
        ),
        ...trees.take(2).toList().asMap().entries.map(
              (e) => Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                child: _DueTreeCard(tree: e.value, onTap: onOpen)
                    .animate(delay: (80 * e.key).ms)
                    .fadeIn()
                    .slideX(begin: 0.08, end: 0),
              ),
            ),
      ],
    );
  }
}

class _DueTreeCard extends StatelessWidget {
  const _DueTreeCard({required this.tree, required this.onTap});

  final Tree tree;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final closes = tree.untilWindowCloses;
    final urgent = closes != null && closes.inDays < 3;

    return DharaCard(
      onTap: onTap,
      padding: const EdgeInsets.all(15),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Center(
              child: Text('\u{1F333}', style: TextStyle(fontSize: 23)),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  tree.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.forest,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  closes == null
                      ? 'Window open now'
                      : 'Closes ${_humanise(closes)}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: urgent ? AppColors.danger : AppColors.inkSoft,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          StatusPill(
            label: 'Check in',
            color: urgent ? AppColors.danger : AppColors.green,
            icon: Icons.camera_alt_rounded,
            compact: true,
          ),
        ],
      ),
    );
  }
}

class _ReturnSection extends StatelessWidget {
  const _ReturnSection({required this.items, required this.onScan});

  final List<TrackedItem> items;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context) {
    final credits = items.fold<int>(0, (sum, i) => sum + i.effectiveCredits);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
      child: DharaCard(
        onTap: onScan,
        gradient: const [AppColors.teal, AppColors.forest],
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Center(
                child: Text('\u{267B}', style: TextStyle(fontSize: 21)),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    items.length == 1
                        ? '1 item ready to return'
                        : '${items.length} items ready to return',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'Worth about $credits credits',
                    style: TextStyle(
                      color: AppColors.limeSoft.withValues(alpha: 0.85),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.arrow_forward_rounded,
              color: Colors.white70,
              size: 19,
            ),
          ],
        ),
      ),
    ).animate(delay: 120.ms).fadeIn().slideY(begin: 0.15, end: 0);
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.onPlant, required this.onScan});

  final VoidCallback onPlant;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
      child: Row(
        children: [
          Expanded(
            child: _ActionTile(
              emoji: '\u{1F331}',
              label: 'Plant a tree',
              caption: 'Earn as it grows',
              tint: AppColors.green,
              onTap: onPlant,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _ActionTile(
              emoji: '\u{1F4F7}',
              label: 'Scan a code',
              caption: 'Pass or return',
              tint: AppColors.info,
              onTap: onScan,
            ),
          ),
        ],
      ),
    ).animate(delay: 180.ms).fadeIn().slideY(begin: 0.15, end: 0);
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.emoji,
    required this.label,
    required this.caption,
    required this.tint,
    required this.onTap,
  });

  final String emoji;
  final String label;
  final String caption;
  final Color tint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return DharaCard(
      onTap: onTap,
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: tint.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Center(child: Text(emoji, style: const TextStyle(fontSize: 19))),
          ),
          const SizedBox(height: 12),
          Text(
            label,
            style: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w800,
              color: AppColors.forest,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            caption,
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
              color: AppColors.inkFaint,
            ),
          ),
        ],
      ),
    );
  }
}

class _ImpactGrid extends StatelessWidget {
  const _ImpactGrid({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    final grams = profile.co2OffsetGrams;
    final co2 = grams >= 1000
        ? '${(grams / 1000).toStringAsFixed(grams >= 10000 ? 0 : 1)} kg'
        : '$grams g';

    final tiles = <Widget>[
      StatTile(
        label: 'Trees alive',
        value: '${profile.treesAlive}',
        emoji: '\u{1F333}',
      ),
      StatTile(
        label: 'Items returned',
        value: '${profile.bottlesReturned}',
        emoji: '\u{267B}',
        tint: AppColors.info,
      ),
      StatTile(
        label: 'CO\u2082 offset',
        value: co2,
        emoji: '\u{1F32B}',
        tint: AppColors.teal,
      ),
      StatTile(
        label: 'Earned all time',
        value: '${profile.creditsLifetime}',
        emoji: '\u{2B50}',
        tint: AppColors.amber,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Your impact'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            // Deliberately generous: the tile stacks an icon, a headline number
            // and a label, which together overflow a squarer box once the
            // system text scale is turned up.
            childAspectRatio: 1.1,
            children: tiles
                .asMap()
                .entries
                .map(
                  (e) => e.value
                      .animate(delay: (70 * e.key).ms)
                      .fadeIn()
                      .scale(begin: const Offset(0.94, 0.94)),
                )
                .toList(),
          ),
        ),
      ],
    );
  }
}

class _FirstStep extends StatelessWidget {
  const _FirstStep({required this.onPlant, required this.onScan});

  final VoidCallback onPlant;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
      child: DharaCard(
        color: AppColors.limeSoft,
        border: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Start earning today',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w800,
                color: AppColors.forest,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Plant a tree and check in on it each month, or scan the code on '
              'packaging you are ready to hand back.',
              style: TextStyle(
                fontSize: 12.5,
                height: 1.45,
                fontWeight: FontWeight.w500,
                color: AppColors.inkSoft,
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                FilledButton(
                  onPressed: () {
                    Haptics.press();
                    onPlant();
                  },
                  child: const Text('Plant a tree'),
                ),
                const SizedBox(width: 10),
                OutlinedButton(
                  onPressed: () {
                    Haptics.tap();
                    onScan();
                  },
                  child: const Text('Scan'),
                ),
              ],
            ),
          ],
        ),
      ),
    ).animate(delay: 220.ms).fadeIn().slideY(begin: 0.15, end: 0);
  }
}

/// Top of the board plus the user's own row, so rank is visible without
/// leaving the dashboard.
class _StandingSection extends ConsumerWidget {
  const _StandingSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final board = ref.watch(leaderboardProvider);
    final mine = ref.watch(myRankProvider);
    final userId = ref.watch(currentUserIdProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Leaderboard'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: board.when(
            loading: () => const LoadingList(count: 1, height: 150),
            error: (_, _) => DharaCard(
              child: Text(
                'Rankings are unavailable right now.',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.inkSoft,
                ),
              ),
            ),
            data: (entries) {
              if (entries.isEmpty) {
                return const DharaCard(
                  child: Text(
                    'No one is ranked yet. Earn your first credits to take the '
                    'top spot.',
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.45,
                      fontWeight: FontWeight.w500,
                      color: AppColors.inkSoft,
                    ),
                  ),
                );
              }

              final top = entries.take(3).toList();
              // Only append the user's own row when it is not already visible.
              final me = mine != null && !top.any((e) => e.userId == mine.userId)
                  ? mine
                  : null;

              return DharaCard(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                child: Column(
                  children: [
                    ...top.asMap().entries.map(
                          (e) => _RankRow(
                            entry: e.value,
                            isMe: e.value.userId == userId,
                          )
                              .animate(delay: (70 * e.key).ms)
                              .fadeIn()
                              .slideX(begin: 0.06, end: 0),
                        ),
                    if (me != null) ...[
                      const Divider(height: 14, color: AppColors.outline),
                      _RankRow(entry: me, isMe: true),
                    ],
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _RankRow extends StatelessWidget {
  const _RankRow({required this.entry, required this.isMe});

  final LeaderboardEntry entry;
  final bool isMe;

  static const _medals = {1: '\u{1F947}', 2: '\u{1F948}', 3: '\u{1F949}'};

  @override
  Widget build(BuildContext context) {
    final medal = _medals[entry.rank];

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          SizedBox(
            width: 28,
            child: medal != null
                ? Text(medal, style: const TextStyle(fontSize: 17))
                : Text(
                    '#${entry.rank}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: AppColors.inkFaint,
                    ),
                  ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              isMe ? 'You' : entry.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: isMe ? FontWeight.w900 : FontWeight.w700,
                color: isMe ? AppColors.green : AppColors.ink,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${entry.score}',
            style: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w800,
              color: AppColors.forest,
            ),
          ),
        ],
      ),
    );
  }
}

String _humanise(Duration d) {
  if (d.inDays >= 2) return 'in ${d.inDays} days';
  if (d.inDays == 1) return 'tomorrow';
  if (d.inHours >= 2) return 'in ${d.inHours} hours';
  if (d.inMinutes >= 2) return 'in ${d.inMinutes} min';
  return 'very soon';
}
