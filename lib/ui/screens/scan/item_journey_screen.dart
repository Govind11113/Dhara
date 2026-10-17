import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/item.dart';
import '../../../state/items_controller.dart';
import '../../widgets/common.dart';

/// The full audit trail for one tracked item.
///
/// Everyone in the chain can read this, which is the point: the record of who
/// held a bottle and when is what makes the credit at the end of it trustworthy.
class ItemJourneyScreen extends ConsumerWidget {
  const ItemJourneyScreen({super.key, required this.code});

  final String code;

  static Future<void> push(BuildContext context, String code) {
    Haptics.tap();
    return Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => ItemJourneyScreen(code: code)),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final journey = ref.watch(itemJourneyProvider(code));

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(title: const Text('Item journey')),
      body: switch (journey) {
        AsyncError(:final error) => ErrorRetry(
            message: friendlyMessage(error),
            onRetry: () => ref.invalidate(itemJourneyProvider(code)),
          ),
        AsyncLoading() => const Padding(
            padding: EdgeInsets.only(top: 20),
            child: LoadingList(count: 3, height: 96),
          ),
        AsyncValue(:final value?) => _Body(journey: value),
      },
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.journey});

  final ItemJourney journey;

  @override
  Widget build(BuildContext context) {
    final item = journey.item;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 36),
      children: [
        _ItemCard(item: item, isYours: journey.isYours),
        const SizedBox(height: 16),
        _JourneyBar(state: item.state),
        const SizedBox(height: 16),
        _StatusNote(journey: journey),

        if (journey.history.isNotEmpty) ...[
          const SectionHeader(
            title: 'Chain of custody',
            padding: EdgeInsets.fromLTRB(0, 26, 0, 14),
          ),
          _Timeline(events: journey.history),
        ],
      ],
    );
  }
}

class _ItemCard extends StatelessWidget {
  const _ItemCard({required this.item, required this.isYours});

  final TrackedItem item;
  final bool isYours;

  @override
  Widget build(BuildContext context) {
    return DharaCard(
      gradient: AppColors.treeGradient,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.17),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Center(
                  child: Text(
                    item.productType.emoji,
                    style: const TextStyle(fontSize: 23),
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      item.brandName.isNotEmpty
                          ? item.brandName
                          : item.productType.label,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.78),
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              if (isYours)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.lime,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'YOURS',
                    style: TextStyle(
                      color: AppColors.forest,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.4,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              _Metric(label: 'Worth', value: '${item.effectiveCredits}'),
              _Metric(label: 'Handovers', value: '${item.transferCount}'),
              _Metric(label: 'Cycles', value: '${item.cycleCount}'),
            ],
          ),
          const SizedBox(height: 14),
          SelectableText(
            item.code,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.55),
              fontSize: 11.5,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    ).animate().fadeIn().slideY(begin: 0.12, end: 0);
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            label,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.7),
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Where the item sits on the factory → consumer → recycled loop.
class _JourneyBar extends StatelessWidget {
  const _JourneyBar({required this.state});

  final ItemState state;

  /// The forward leg and the return leg are shown as two halves so it reads as
  /// a loop rather than one long line.
  static const _outbound = [
    ItemState.atFactory,
    ItemState.withWholesaler,
    ItemState.withRetailer,
    ItemState.withConsumer,
  ];

  static const _inbound = [
    ItemState.returnedToRetailer,
    ItemState.returnedToWholesaler,
    ItemState.returnedToFactory,
    ItemState.recycled,
  ];

  @override
  Widget build(BuildContext context) {
    if (state == ItemState.voided) {
      return const DharaCard(
        child: Row(
          children: [
            Icon(Icons.block_rounded, size: 19, color: AppColors.danger),
            SizedBox(width: 11),
            Expanded(
              child: Text(
                'This item has been retired and can no longer move.',
                style: TextStyle(
                  fontSize: 12.5,
                  height: 1.4,
                  fontWeight: FontWeight.w600,
                  color: AppColors.inkSoft,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return DharaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'Progress',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.forest,
                ),
              ),
              const Spacer(),
              Text(
                '${(state.journeyProgress * 100).round()}%',
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.green,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _Leg(label: 'Out to you', stages: _outbound, current: state),
          const SizedBox(height: 14),
          _Leg(label: 'Back for recycling', stages: _inbound, current: state),
        ],
      ),
    ).animate(delay: 90.ms).fadeIn().slideY(begin: 0.12, end: 0);
  }
}

class _Leg extends StatelessWidget {
  const _Leg({
    required this.label,
    required this.stages,
    required this.current,
  });

  final String label;
  final List<ItemState> stages;
  final ItemState current;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppColors.inkFaint,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: stages.asMap().entries.map((e) {
            final stage = e.value;
            // Progress is the ordering, so this stays correct without hardcoding
            // an index for every state.
            final reached = current.journeyProgress >= stage.journeyProgress;
            final isCurrent = stage == current;

            return Expanded(
              child: Padding(
                padding: EdgeInsets.only(
                  right: e.key == stages.length - 1 ? 0 : 5,
                ),
                child: Column(
                  children: [
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 400),
                      height: 6,
                      decoration: BoxDecoration(
                        color: reached ? AppColors.green : AppColors.outline,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      stage.holder.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 9.5,
                        fontWeight: isCurrent
                            ? FontWeight.w900
                            : FontWeight.w600,
                        color: isCurrent
                            ? AppColors.green
                            : reached
                                ? AppColors.inkSoft
                                : AppColors.inkFaint,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }
}

class _StatusNote extends StatelessWidget {
  const _StatusNote({required this.journey});

  final ItemJourney journey;

  @override
  Widget build(BuildContext context) {
    final item = journey.item;
    final terminal = CustodyRules.isTerminal(item.state);

    final (tint, icon, text) = switch (journey) {
      _ when terminal => (
          AppColors.info,
          Icons.verified_rounded,
          'This item has completed its journey: ${item.state.label.toLowerCase()}.',
        ),
      ItemJourney(canTransfer: true, nextState: final next?) => (
          AppColors.green,
          Icons.swap_horiz_rounded,
          'Ready to hand over. Next stop: ${next.label.toLowerCase()}.',
        ),
      _ => (
          AppColors.amber,
          Icons.info_outline_rounded,
          CustodyRules.explain(item.state, journey.yourRole),
        ),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: tint),
          const SizedBox(width: 11),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.45,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
          ),
        ],
      ),
    ).animate(delay: 150.ms).fadeIn();
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.events});

  final List<CustodyEvent> events;

  @override
  Widget build(BuildContext context) {
    final format = DateFormat('d MMM yyyy, h:mm a');

    return Column(
      children: events.asMap().entries.map((e) {
        final event = e.value;
        final isLast = e.key == events.length - 1;
        final to = event.to;

        final tint = switch (event.direction) {
          TransferDirection.forward => AppColors.info,
          TransferDirection.returnLeg => AppColors.green,
          TransferDirection.recycle => AppColors.teal,
        };

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: tint.withValues(alpha: 0.13),
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Icon(
                      event.direction == TransferDirection.recycle
                          ? Icons.recycling_rounded
                          : event.direction == TransferDirection.returnLeg
                              ? Icons.undo_rounded
                              : Icons.arrow_downward_rounded,
                      size: 15,
                      color: tint,
                    ),
                  ),
                ),
                if (!isLast)
                  Container(
                    width: 2,
                    height: 44,
                    color: AppColors.outline,
                  ),
              ],
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      to.label,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.forest,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${event.fromRole.label} \u2192 ${event.toRole.label}'
                      ' \u00B7 ${format.format(event.occurredAt)}',
                      style: const TextStyle(
                        fontSize: 11.5,
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                        color: AppColors.inkSoft,
                      ),
                    ),
                    if (event.creditsAwarded > 0) ...[
                      const SizedBox(height: 6),
                      StatusPill(
                        label: '+${event.creditsAwarded} credits',
                        color: AppColors.green,
                        compact: true,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ).animate(delay: (50 * e.key).ms).fadeIn().slideX(begin: 0.05, end: 0);
      }).toList(),
    );
  }
}
