import 'dart:math' as math;

import 'package:confetti/confetti.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/theme/app_colors.dart';
import '../../core/utils/haptics.dart';
import 'common.dart';

/// The payoff sheet shown after anything that earns credits.
///
/// Also handles the "accepted but held for review" case, which is not a failure:
/// the submission counted, the credits are simply withheld until a human looks.
/// Conflating that with an error would make honest users think they lost work.
Future<void> showAwardSheet(
  BuildContext context, {
  required String title,
  required int credits,
  String emoji = '\u{1F331}',
  String message = '',
  List<String> reasons = const [],
  bool needsReview = false,
  int streakBonus = 0,
  int? balance,
  String actionLabel = 'Nice',
}) {
  if (needsReview) {
    Haptics.warn();
  } else if (credits > 0) {
    Haptics.celebrate();
  } else {
    Haptics.success();
  }

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black54,
    builder: (_) => _AwardSheet(
      title: title,
      credits: credits,
      emoji: emoji,
      message: message,
      reasons: reasons,
      needsReview: needsReview,
      streakBonus: streakBonus,
      balance: balance,
      actionLabel: actionLabel,
    ),
  );
}

class _AwardSheet extends StatefulWidget {
  const _AwardSheet({
    required this.title,
    required this.credits,
    required this.emoji,
    required this.message,
    required this.reasons,
    required this.needsReview,
    required this.streakBonus,
    required this.balance,
    required this.actionLabel,
  });

  final String title;
  final int credits;
  final String emoji;
  final String message;
  final List<String> reasons;
  final bool needsReview;
  final int streakBonus;
  final int? balance;
  final String actionLabel;

  @override
  State<_AwardSheet> createState() => _AwardSheetState();
}

class _AwardSheetState extends State<_AwardSheet> {
  late final ConfettiController _confetti;

  bool get _celebrating => !widget.needsReview && widget.credits > 0;

  @override
  void initState() {
    super.initState();
    _confetti = ConfettiController(duration: const Duration(seconds: 2));
    if (_celebrating) _confetti.play();
  }

  @override
  void dispose() {
    _confetti.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.credits + widget.streakBonus;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Stack(
          alignment: Alignment.topCenter,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(22, 26, 22, 20),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(28),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 74,
                    height: 74,
                    decoration: BoxDecoration(
                      color: widget.needsReview
                          ? AppColors.amber.withValues(alpha: 0.14)
                          : AppColors.surfaceMuted,
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Text(
                        widget.needsReview ? '\u{1F50D}' : widget.emoji,
                        style: const TextStyle(fontSize: 33),
                      ),
                    ),
                  )
                      .animate()
                      .scale(duration: 450.ms, curve: Curves.easeOutBack)
                      .fadeIn(),
                  const SizedBox(height: 18),

                  Text(
                    widget.title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w800,
                      color: AppColors.forest,
                    ),
                  ).animate(delay: 90.ms).fadeIn().slideY(begin: 0.2, end: 0),

                  if (total > 0 && !widget.needsReview) ...[
                    const SizedBox(height: 14),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          '+',
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                            color: AppColors.green.withValues(alpha: 0.7),
                          ),
                        ),
                        AnimatedCounter(
                          value: total,
                          duration: const Duration(milliseconds: 1100),
                          style: const TextStyle(
                            fontSize: 48,
                            height: 1.05,
                            fontWeight: FontWeight.w900,
                            color: AppColors.green,
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.only(bottom: 8, left: 6),
                          child: Text(
                            'credits',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.inkSoft,
                            ),
                          ),
                        ),
                      ],
                    ).animate(delay: 150.ms).fadeIn(),
                  ],

                  if (widget.streakBonus > 0 && !widget.needsReview) ...[
                    const SizedBox(height: 10),
                    StatusPill(
                      label:
                          '\u{1F525} ${widget.streakBonus} streak bonus included',
                      color: AppColors.amber,
                    ).animate(delay: 320.ms).fadeIn().scale(
                          begin: const Offset(0.9, 0.9),
                          curve: Curves.easeOutBack,
                        ),
                  ],

                  if (widget.message.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    Text(
                      widget.message,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.5,
                        fontWeight: FontWeight.w500,
                        color: AppColors.inkSoft,
                      ),
                    ).animate(delay: 220.ms).fadeIn(),
                  ],

                  if (widget.reasons.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _ReasonBox(reasons: widget.reasons),
                  ],

                  if (widget.balance != null) ...[
                    const SizedBox(height: 18),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceMuted,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Available balance',
                            style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.inkSoft,
                            ),
                          ),
                          Text(
                            '${widget.balance}',
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w900,
                              color: AppColors.forest,
                            ),
                          ),
                        ],
                      ),
                    ).animate(delay: 380.ms).fadeIn(),
                  ],

                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () {
                        Haptics.tap();
                        Navigator.of(context).pop();
                      },
                      child: Text(widget.actionLabel),
                    ),
                  ).animate(delay: 430.ms).fadeIn(),
                ],
              ),
            ),

            if (_celebrating)
              ConfettiWidget(
                confettiController: _confetti,
                blastDirection: math.pi / 2,
                emissionFrequency: 0.06,
                numberOfParticles: 14,
                maxBlastForce: 18,
                minBlastForce: 6,
                gravity: 0.28,
                shouldLoop: false,
                colors: const [
                  AppColors.green,
                  AppColors.lime,
                  AppColors.sage,
                  AppColors.amber,
                ],
              ),
          ],
        ),
      ),
    );
  }
}

/// Server reason codes are machine strings; map the ones a user can act on
/// and fall back to a readable form of the code rather than hiding it.
///
/// Top-level rather than private to [_ReasonBox] so a test can assert that
/// every code the server emits has a sentence — the fallback is a last resort,
/// not something a user should be shown.
String reasonText(String code) =>
    _reasonStrings[code] ?? code.replaceAll('_', ' ');

const _reasonStrings = {
  'low_plant_confidence': 'We could not clearly see a plant in the photo.',
  'duplicate_photo': 'This photo looks like one submitted before.',
  'poor_gps_accuracy': 'The GPS signal was weak.',
  'mocked_location': 'The location looked simulated.',
  'height_shrunk': 'The height entered was lower than last time.',
  'new_account':
      'New accounts are checked once before credits are released.',
  'low_trust': 'Recent activity on this account is being reviewed.',
  'height_jump': 'The growth since last month looked unusually large.',
  // Emitted by the server-side vision check in functions/api/src/lib/vision.js.
  'ai_low_confidence':
      'Our checks were not confident about this photo, so a person will look '
          'at it.',
  'ai_not_a_plant':
      'We could not find a real plant in the photo. Get the whole sapling in '
          'frame with the ground visible.',
  'ai_species_mismatch':
      'The plant did not look like the species you picked. Check the species, '
          'or send feedback if we got it wrong.',
  'ai_screen_photo':
      'That looked like a photo of a screen rather than a real tree.',
  'ai_unavailable':
      'Our automatic photo check was not available, so a person will look at '
          'this before credits are released.',
};

class _ReasonBox extends StatelessWidget {
  const _ReasonBox({required this.reasons});

  final List<String> reasons;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.amber.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: reasons.map((raw) {
          final text = reasonText(raw);
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 2),
                  child: Icon(
                    Icons.info_outline_rounded,
                    size: 14,
                    color: AppColors.amber,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    text,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.4,
                      fontWeight: FontWeight.w600,
                      color: AppColors.inkSoft,
                    ),
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    ).animate(delay: 280.ms).fadeIn();
  }
}
