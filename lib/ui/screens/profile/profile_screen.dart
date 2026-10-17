import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/env.dart';
import '../../../core/services/media.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/profile.dart';
import '../../../data/models/reward.dart';
import '../../../state/auth_controller.dart';
import '../../../state/leaderboard_controller.dart';
import '../../../state/rewards_controller.dart';
import '../../widgets/common.dart';
import '../footprint/footprint_screen.dart';
import '../leaderboard/badges_screen.dart';
import '../leaderboard/leaderboard_screen.dart';
import '../rewards/electricity_verify_screen.dart';
import 'credit_history_screen.dart';
import 'feedback_screen.dart';

/// The "You" tab: identity, progress, and everything that opens off it.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(currentProfileProvider);

    return LightStatusBar(
      child: Scaffold(
        backgroundColor: AppColors.canvas,
        body: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(badgesProvider);
            ref.invalidate(creditHistoryProvider);
            ref.invalidate(electricityAccountProvider);
            await ref.read(authControllerProvider.notifier).refreshProfile();
          },
          color: AppColors.green,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(child: _Header(profile: profile)),

              if (profile == null)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.only(top: 24),
                    child: LoadingList(count: 3, height: 84),
                  ),
                )
              else ...[
                SliverToBoxAdapter(child: _CreditsCard(profile: profile)),
                const SliverToBoxAdapter(child: _BadgeStrip()),
                SliverToBoxAdapter(child: _ImpactCard(profile: profile)),
                if (profile.referralCode != null &&
                    profile.referralCode!.isNotEmpty)
                  SliverToBoxAdapter(
                    child: _ReferralCard(code: profile.referralCode!),
                  ),
                SliverToBoxAdapter(child: _Links(profile: profile)),
                if (profile.trustScore < 80)
                  const SliverToBoxAdapter(child: _ReviewNote()),
                const SliverToBoxAdapter(child: _SignOutButton()),
              ],

              const SliverToBoxAdapter(child: SizedBox(height: 120)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends ConsumerWidget {
  const _Header({required this.profile});

  final Profile? profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name = (profile?.name ?? '').trim();

    return GradientHeader(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 26),
      child: Column(
        children: [
          _Avatar(profile: profile),
          const SizedBox(height: 14),
          Text(
            name.isEmpty ? 'Your profile' : name,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 21,
              fontWeight: FontWeight.w800,
            ),
          ),
          if (profile != null) ...[
            const SizedBox(height: 4),
            Text(
              profile!.email,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white60,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 16),
            _LevelBar(profile: profile!),
          ],
        ],
      ),
    ).animate().fadeIn(duration: 320.ms);
  }
}

/// The stored avatar if there is one, otherwise initials.
///
/// The avatars bucket is private to its owner, so this only ever resolves for
/// the signed-in user — which is all this screen needs.
class _Avatar extends ConsumerWidget {
  const _Avatar({required this.profile});

  final Profile? profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fileId = profile?.avatarFileId;

    final fallback = Center(
      child: Text(
        initialsOf(profile?.name ?? ''),
        style: const TextStyle(
          color: Colors.white,
          fontSize: 27,
          fontWeight: FontWeight.w900,
        ),
      ),
    );

    final inner = fileId == null || fileId.isEmpty
        ? fallback
        : ref.watch(photoBytesProvider('${Buckets.avatars}/$fileId')).when(
              loading: () => fallback,
              // A missing or unreadable avatar file must not break the header.
              error: (_, _) => fallback,
              data: (bytes) => ClipOval(
                child: Image.memory(
                  bytes,
                  width: 84,
                  height: 84,
                  fit: BoxFit.cover,
                ),
              ),
            );

    return Container(
      width: 84,
      height: 84,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.lime, width: 2),
      ),
      child: inner,
    ).animate().scale(
          duration: 480.ms,
          curve: Curves.easeOutBack,
          begin: const Offset(0.85, 0.85),
        );
  }
}

class _LevelBar extends StatelessWidget {
  const _LevelBar({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    final maxed = profile.isMaxLevel;
    final toGo = profile.xpForNextLevel - profile.xp;

    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            StatusPill(
              label: 'Level ${profile.level}',
              color: AppColors.lime,
              compact: true,
            ),
            const SizedBox(width: 8),
            Text(
              profile.levelTitle,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: TweenAnimationBuilder<double>(
            tween: Tween<double>(begin: 0, end: profile.levelProgress),
            duration: const Duration(milliseconds: 900),
            curve: Curves.easeOutCubic,
            builder: (context, shown, _) => LinearProgressIndicator(
              value: shown,
              minHeight: 7,
              backgroundColor: Colors.white24,
              valueColor: const AlwaysStoppedAnimation(AppColors.lime),
            ),
          ),
        ),
        const SizedBox(height: 7),
        Text(
          maxed
              ? 'Top level reached \u2014 ${profile.xp} XP'
              : '$toGo XP to level ${profile.level + 1}',
          style: const TextStyle(
            color: Colors.white60,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _CreditsCard extends StatelessWidget {
  const _CreditsCard({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: DharaCard(
        onTap: () => CreditHistoryScreen.push(context),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Credits',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: AppColors.forest,
                    ),
                  ),
                ),
                const Text(
                  'See history',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.green,
                  ),
                ),
                const Icon(
                  Icons.chevron_right_rounded,
                  size: 18,
                  color: AppColors.green,
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                _Figure(
                  label: 'Available',
                  value: profile.creditsAvailable,
                  tint: AppColors.green,
                ),
                _Figure(
                  label: 'Vesting',
                  value: profile.creditsPending,
                  tint: AppColors.amber,
                ),
                _Figure(
                  label: 'Lifetime',
                  value: profile.creditsLifetime,
                  tint: AppColors.info,
                ),
              ],
            ),
          ],
        ),
      ),
    ).animate(delay: 90.ms).fadeIn().slideY(begin: 0.12, end: 0);
  }
}

class _Figure extends StatelessWidget {
  const _Figure({
    required this.label,
    required this.value,
    required this.tint,
  });

  final String label;
  final int value;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AnimatedCounter(
            value: value,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w900,
              color: tint,
              height: 1,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.inkSoft,
            ),
          ),
        ],
      ),
    );
  }
}

/// A horizontal peek at earned badges, with the count of what is still locked.
class _BadgeStrip extends ConsumerWidget {
  const _BadgeStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final all = ref.watch(badgesProvider).value ?? const <BadgeItem>[];
    final earned = all.where((b) => b.isEarned).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: 'Badges',
          action: all.isEmpty ? null : 'See all',
          onAction: all.isEmpty ? null : () => BadgesScreen.push(context),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: DharaCard(
            onTap: () => BadgesScreen.push(context),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            child: earned.isEmpty
                ? Row(
                    children: [
                      const Text('\u{1F3C5}', style: TextStyle(fontSize: 22)),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          all.isEmpty
                              ? 'Badges are on the way.'
                              : 'No badges yet. ${all.length} waiting to be '
                                  'unlocked.',
                          style: const TextStyle(
                            fontSize: 12.5,
                            height: 1.4,
                            fontWeight: FontWeight.w600,
                            color: AppColors.inkSoft,
                          ),
                        ),
                      ),
                    ],
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          // Overflow beyond six is reported as a count rather
                          // than squeezing the medallions.
                          ...earned.take(6).map(
                                (b) => Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: _BadgeChip(badge: b),
                                ),
                              ),
                          if (earned.length > 6)
                            Text(
                              '+${earned.length - 6}',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                                color: AppColors.inkFaint,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        '${earned.length} of ${all.length} earned',
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.inkSoft,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ],
    ).animate(delay: 140.ms).fadeIn();
  }
}

class _BadgeChip extends StatelessWidget {
  const _BadgeChip({required this.badge});

  final BadgeItem badge;

  @override
  Widget build(BuildContext context) {
    final tint = badgeTierColor(badge.tier);

    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.16),
        shape: BoxShape.circle,
        border: Border.all(color: tint.withValues(alpha: 0.55), width: 1.4),
      ),
      child: Center(
        child: Text(badge.emoji, style: const TextStyle(fontSize: 17)),
      ),
    );
  }
}

class _ImpactCard extends StatelessWidget {
  const _ImpactCard({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    final co2 = profile.co2OffsetGrams;
    final co2Label = co2 >= 1000
        ? '${(co2 / 1000).toStringAsFixed(co2 >= 10000 ? 0 : 1)} kg'
        : '$co2 g';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Your impact'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: DharaCard(
            child: Column(
              children: [
                Row(
                  children: [
                    _Stat(
                      emoji: '\u{1F333}',
                      value: '${profile.treesAlive}',
                      label: 'trees alive',
                    ),
                    _Stat(
                      emoji: '\u{267B}',
                      value: '${profile.bottlesReturned}',
                      label: 'items returned',
                    ),
                  ],
                ),
                const Divider(height: 26, color: AppColors.outline),
                Row(
                  children: [
                    _Stat(
                      emoji: '\u{1F32B}',
                      value: co2Label,
                      label: 'CO\u2082 offset',
                    ),
                    _Stat(
                      emoji: '\u{1F525}',
                      value: '${profile.streakCount}',
                      label: profile.longestStreak > profile.streakCount
                          ? 'streak (best ${profile.longestStreak})'
                          : 'month streak',
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    ).animate(delay: 180.ms).fadeIn();
  }
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.emoji,
    required this.value,
    required this.label,
  });

  final String emoji;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Row(
        children: [
          Text(emoji, style: const TextStyle(fontSize: 20)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                    color: AppColors.forest,
                  ),
                ),
                Text(
                  label,
                  maxLines: 2,
                  style: const TextStyle(
                    fontSize: 10.5,
                    height: 1.25,
                    fontWeight: FontWeight.w700,
                    color: AppColors.inkSoft,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReferralCard extends StatelessWidget {
  const _ReferralCard({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: DharaCard(
        color: AppColors.limeSoft,
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Invite a friend',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: AppColors.forest,
                    ),
                  ),
                  const SizedBox(height: 3),
                  const Text(
                    'Share your code and you both earn credits.',
                    style: TextStyle(
                      fontSize: 11.5,
                      height: 1.4,
                      fontWeight: FontWeight.w600,
                      color: AppColors.inkSoft,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    code,
                    style: const TextStyle(
                      fontSize: 17,
                      letterSpacing: 1.8,
                      fontWeight: FontWeight.w900,
                      color: AppColors.forest,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            IconButton(
              onPressed: () async {
                Haptics.success();
                await Clipboard.setData(ClipboardData(text: code));
                if (context.mounted) showSnack(context, 'Code copied');
              },
              icon: const Icon(Icons.copy_rounded),
              color: AppColors.green,
              tooltip: 'Copy code',
            ),
          ],
        ),
      ),
    ).animate(delay: 220.ms).fadeIn().slideY(begin: 0.1, end: 0);
  }
}

class _Links extends ConsumerWidget {
  const _Links({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final account = ref.watch(electricityAccountProvider).value;

    final (billLabel, billTint) = switch (account) {
      null => ('Not linked yet', AppColors.inkFaint),
      ElectricityAccount(isVerified: true) => (account.masked, AppColors.green),
      ElectricityAccount(isPending: true) => ('Under review', AppColors.amber),
      _ => ('Needs another try', AppColors.danger),
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Account'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: DharaCard(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              children: [
                _LinkRow(
                  icon: Icons.emoji_events_rounded,
                  label: 'Leaderboard',
                  onTap: () => LeaderboardScreen.push(context),
                ),
                _LinkRow(
                  icon: Icons.receipt_long_rounded,
                  label: 'Credit history',
                  onTap: () => CreditHistoryScreen.push(context),
                ),
                _LinkRow(
                  icon: Icons.co2_rounded,
                  label: 'Carbon footprint',
                  onTap: () => FootprintScreen.push(context),
                ),
                _LinkRow(
                  icon: Icons.bolt_rounded,
                  label: 'Electricity account',
                  trailing: billLabel,
                  trailingTint: billTint,
                  // Verified and in-review accounts have nothing to change; only
                  // an unlinked or rejected one needs the form again.
                  onTap: account == null || account.isRejected
                      ? () => ElectricityVerifyScreen.push(context)
                      : null,
                ),
                _LinkRow(
                  icon: Icons.workspace_premium_rounded,
                  label: 'Badges',
                  onTap: () => BadgesScreen.push(context),
                ),
                _LinkRow(
                  icon: Icons.chat_bubble_outline_rounded,
                  label: 'Send feedback',
                  onTap: () => FeedbackScreen.push(context),
                ),
                _LinkRow(
                  icon: Icons.alternate_email_rounded,
                  label: 'Email',
                  trailing: profile.email,
                  onTap: null,
                  last: true,
                ),
              ],
            ),
          ),
        ),
      ],
    ).animate(delay: 260.ms).fadeIn();
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.icon,
    required this.label,
    this.trailing,
    this.trailingTint,
    this.onTap,
    this.last = false,
  });

  final IconData icon;
  final String label;
  final String? trailing;
  final Color? trailingTint;
  final VoidCallback? onTap;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      child: Row(
        children: [
          Icon(icon, size: 19, color: AppColors.green),
          const SizedBox(width: 13),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
          ),
          if (trailing != null)
            Flexible(
              child: Text(
                trailing!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.right,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: trailingTint ?? AppColors.inkSoft,
                ),
              ),
            ),
          if (onTap != null) ...[
            const SizedBox(width: 4),
            const Icon(
              Icons.chevron_right_rounded,
              size: 19,
              color: AppColors.inkFaint,
            ),
          ],
        ],
      ),
    );

    return Column(
      children: [
        if (onTap == null)
          row
        else
          PressableScale(onTap: onTap!, radius: 12, child: row),
        if (!last)
          const Divider(
            height: 1,
            indent: 14,
            endIndent: 14,
            color: AppColors.outline,
          ),
      ],
    );
  }
}

/// Shown when trust is low enough that submissions get held for review.
///
/// Deliberately vague about the score itself: naming the exact number would
/// hand anyone gaming the system a dial to watch.
class _ReviewNote extends StatelessWidget {
  const _ReviewNote();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: AppColors.amber.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(15),
        ),
        child: const Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              Icons.shield_outlined,
              size: 18,
              color: AppColors.amber,
            ),
            SizedBox(width: 11),
            Expanded(
              child: Text(
                'Some of your submissions are being checked by a person before '
                'credits are released. Keep photographing your own trees from '
                'close up and this clears on its own.',
                style: TextStyle(
                  fontSize: 12,
                  height: 1.45,
                  fontWeight: FontWeight.w600,
                  color: AppColors.inkSoft,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SignOutButton extends ConsumerWidget {
  const _SignOutButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 26, 20, 0),
      child: OutlinedButton.icon(
        onPressed: () => _confirm(context, ref),
        icon: const Icon(Icons.logout_rounded, size: 18),
        label: const Text('Sign out'),
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.danger,
          side: const BorderSide(color: AppColors.outline),
          minimumSize: const Size.fromHeight(50),
        ),
      ),
    );
  }

  Future<void> _confirm(BuildContext context, WidgetRef ref) async {
    Haptics.warn();

    final leave = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
          'Your trees, credits and history stay on your account.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Stay'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );

    if (leave != true || !context.mounted) return;

    try {
      // The router watches auth state, so this navigates on its own.
      await ref.read(authControllerProvider.notifier).signOut();
    } catch (e) {
      if (!context.mounted) return;
      showSnack(context, friendlyMessage(e), isError: true);
    }
  }
}
