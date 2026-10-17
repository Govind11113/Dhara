import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/reward.dart';
import '../../../state/auth_controller.dart';
import '../../../state/leaderboard_controller.dart';
import '../../widgets/common.dart';

/// The full board, with a podium for the top three and the caller's own
/// standing held in the header.
///
/// Ranking comes from a server-published snapshot: `profiles` is readable only
/// by its owner, so the client has no way to sort other people's scores itself.
class LeaderboardScreen extends ConsumerWidget {
  const LeaderboardScreen({super.key});

  static Future<void> push(BuildContext context) {
    Haptics.tap();
    return Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const LeaderboardScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final board = ref.watch(leaderboardProvider);
    final period = ref.watch(leaderboardPeriodProvider);
    final mine = ref.watch(myRankProvider);
    final userId = ref.watch(currentUserIdProvider);

    return LightStatusBar(
      child: Scaffold(
        backgroundColor: AppColors.canvas,
        body: RefreshIndicator(
          onRefresh: () async => ref.invalidate(leaderboardProvider),
          color: AppColors.green,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: _Header(
                  period: period,
                  mine: mine,
                  total: board.value?.length ?? 0,
                  loading: board.isLoading,
                  onPeriod: (next) {
                    Haptics.select();
                    ref
                        .read(leaderboardPeriodProvider.notifier)
                        .select(next);
                  },
                ),
              ),
              ...switch (board) {
                AsyncError(:final error) => [
                    SliverFillRemaining(
                      hasScrollBody: false,
                      child: ErrorRetry(
                        message: friendlyMessage(error),
                        onRetry: () => ref.invalidate(leaderboardProvider),
                      ),
                    ),
                  ],
                AsyncLoading() => const [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.only(top: 24),
                        child: LoadingList(count: 4, height: 74),
                      ),
                    ),
                  ],
                AsyncValue(:final value?) => _rows(value, userId),
              },
              const SliverToBoxAdapter(child: SizedBox(height: 40)),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _rows(List<LeaderboardEntry> entries, String? userId) {
    if (entries.isEmpty) {
      return const [
        SliverFillRemaining(
          hasScrollBody: false,
          child: EmptyState(
            emoji: '\u{1F331}',
            title: 'Nobody is ranked yet',
            message:
                'Plant a tree or return some packaging and the first place is '
                'yours.',
          ),
        ),
      ];
    }

    final podium = entries.take(3).toList();
    final rest = entries.skip(3).toList();

    return [
      SliverToBoxAdapter(child: _Podium(top: podium, userId: userId)),
      if (rest.isNotEmpty)
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
          sliver: SliverList.separated(
            itemCount: rest.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (context, i) {
              final entry = rest[i];
              return _BoardRow(
                entry: entry,
                isMe: entry.userId == userId,
              )
                  // Only the first screenful is staggered; past that the delay
                  // would outlast the scroll and the row would appear late.
                  .animate(delay: (i < 10 ? 40 * i : 0).ms)
                  .fadeIn()
                  .slideY(begin: 0.1, end: 0);
            },
          ),
        ),
    ];
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.period,
    required this.mine,
    required this.total,
    required this.loading,
    required this.onPeriod,
  });

  final LeaderboardPeriod period;
  final LeaderboardEntry? mine;
  final int total;
  final bool loading;
  final ValueChanged<LeaderboardPeriod> onPeriod;

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
                  'Leaderboard',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          _PeriodToggle(period: period, onSelect: onPeriod),
          const SizedBox(height: 18),
          _MyStanding(mine: mine, total: total, loading: loading),
        ],
      ),
    );
  }
}

/// Two-way switch between the all-time and monthly boards.
class _PeriodToggle extends StatelessWidget {
  const _PeriodToggle({required this.period, required this.onSelect});

  final LeaderboardPeriod period;
  final ValueChanged<LeaderboardPeriod> onSelect;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.22),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: LeaderboardPeriod.values.map((value) {
          final selected = value == period;
          return Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: selected ? null : () => onSelect(value),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOut,
                padding: const EdgeInsets.symmetric(vertical: 9),
                decoration: BoxDecoration(
                  color: selected ? AppColors.lime : Colors.transparent,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Center(
                  child: Text(
                    value.label,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: selected ? AppColors.forest : Colors.white70,
                    ),
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

/// The caller's own row, kept in the header so their rank is on screen no
/// matter how far down the list they are.
class _MyStanding extends StatelessWidget {
  const _MyStanding({
    required this.mine,
    required this.total,
    required this.loading,
  });

  final LeaderboardEntry? mine;
  final int total;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final entry = mine;

    final body = entry == null
        ? Row(
            children: [
              const Icon(
                Icons.trending_up_rounded,
                color: AppColors.lime,
                size: 19,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Text(
                  loading
                      ? 'Working out where you stand\u2026'
                      : 'Earn your first credits to join the board.',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12.5,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          )
        : Row(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'YOUR RANK',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: 9.5,
                      letterSpacing: 0.7,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      AnimatedCounter(
                        value: entry.rank,
                        prefix: '#',
                        style: const TextStyle(
                          color: AppColors.lime,
                          fontSize: 25,
                          fontWeight: FontWeight.w900,
                          height: 1,
                        ),
                      ),
                      if (total > 0) ...[
                        const SizedBox(width: 4),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 2),
                          child: Text(
                            'of $total',
                            style: const TextStyle(
                              color: Colors.white54,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
              const Spacer(),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '${entry.score}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const Text(
                    'credits earned',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ],
          );

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(18),
      ),
      child: body,
    ).animate(delay: 120.ms).fadeIn().slideY(begin: 0.15, end: 0);
  }
}

/// Top three, sized by placing.
class _Podium extends StatelessWidget {
  const _Podium({required this.top, required this.userId});

  final List<LeaderboardEntry> top;
  final String? userId;

  @override
  Widget build(BuildContext context) {
    // Second, first, third: the tallest column belongs in the middle.
    final order = <LeaderboardEntry?>[
      top.length > 1 ? top[1] : null,
      top.isNotEmpty ? top[0] : null,
      top.length > 2 ? top[2] : null,
    ];

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: order.asMap().entries.map((e) {
          final entry = e.value;
          if (entry == null) return const Expanded(child: SizedBox.shrink());

          return Expanded(
            child: _PodiumColumn(
              entry: entry,
              isMe: entry.userId == userId,
            ).animate(delay: (120 * e.key).ms).fadeIn().slideY(
                  begin: 0.2,
                  end: 0,
                  curve: Curves.easeOutBack,
                ),
          );
        }).toList(),
      ),
    );
  }
}

class _PodiumColumn extends StatelessWidget {
  const _PodiumColumn({required this.entry, required this.isMe});

  final LeaderboardEntry entry;
  final bool isMe;

  static const _medals = {1: '\u{1F947}', 2: '\u{1F948}', 3: '\u{1F949}'};

  @override
  Widget build(BuildContext context) {
    final first = entry.rank == 1;
    final tint = switch (entry.rank) {
      1 => AppColors.gold,
      2 => AppColors.silver,
      _ => AppColors.bronze,
    };

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Column(
        children: [
          Text(
            _medals[entry.rank] ?? '#${entry.rank}',
            style: TextStyle(fontSize: first ? 30 : 24),
          ),
          const SizedBox(height: 8),
          _Avatar(name: entry.name, size: first ? 54 : 44, tint: tint),
          const SizedBox(height: 8),
          Text(
            isMe ? 'You' : entry.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: first ? 13 : 12,
              fontWeight: FontWeight.w800,
              color: isMe ? AppColors.green : AppColors.forest,
            ),
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            height: first ? 82 : (entry.rank == 2 ? 62 : 48),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  tint.withValues(alpha: 0.28),
                  tint.withValues(alpha: 0.12),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(14),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 4),
              child: Column(
                children: [
                  Text(
                    '${entry.score}',
                    style: TextStyle(
                      fontSize: first ? 18 : 15.5,
                      fontWeight: FontWeight.w900,
                      color: AppColors.forest,
                    ),
                  ),
                  const Text(
                    'credits',
                    style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.inkSoft,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BoardRow extends StatelessWidget {
  const _BoardRow({required this.entry, required this.isMe});

  final LeaderboardEntry entry;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    return DharaCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      color: isMe ? AppColors.limeSoft : null,
      child: Row(
        children: [
          SizedBox(
            width: 30,
            child: Text(
              '#${entry.rank}',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
                color: isMe ? AppColors.green : AppColors.inkFaint,
              ),
            ),
          ),
          _Avatar(name: entry.name, size: 36, tint: AppColors.sage),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isMe ? 'You' : entry.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: isMe ? FontWeight.w900 : FontWeight.w700,
                    color: isMe ? AppColors.green : AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _detail(entry),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.inkSoft,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${entry.score}',
                style: const TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w900,
                  color: AppColors.forest,
                ),
              ),
              if (entry.streakCount > 1)
                Text(
                  '\u{1F525} ${entry.streakCount}',
                  style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.inkFaint,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  static String _detail(LeaderboardEntry e) {
    final parts = <String>['Level ${e.level}'];
    if (e.treesAlive > 0) {
      parts.add('${e.treesAlive} ${e.treesAlive == 1 ? 'tree' : 'trees'}');
    }
    if (e.bottlesReturned > 0) parts.add('${e.bottlesReturned} returned');
    return parts.join(' \u00B7 ');
  }
}

/// Initials rather than a photo.
///
/// The avatars bucket is private per owner, so another member's file would not
/// load anyway — and a list of network fetches would stutter while scrolling.
class _Avatar extends StatelessWidget {
  const _Avatar({
    required this.name,
    required this.size,
    required this.tint,
  });

  final String name;
  final double size;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.22),
        shape: BoxShape.circle,
        border: Border.all(color: tint.withValues(alpha: 0.5), width: 1.5),
      ),
      child: Center(
        child: Text(
          initialsOf(name),
          style: TextStyle(
            fontSize: size * 0.36,
            fontWeight: FontWeight.w900,
            color: AppColors.forest,
          ),
        ),
      ),
    );
  }
}

/// Up to two initials from a display name, for avatar placeholders.
String initialsOf(String name) {
  final words = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((w) => w.isNotEmpty)
      .toList();
  if (words.isEmpty) return '?';
  if (words.length == 1) {
    final word = words.first;
    return word.substring(0, word.length >= 2 ? 2 : 1).toUpperCase();
  }
  return '${words.first[0]}${words.last[0]}'.toUpperCase();
}
