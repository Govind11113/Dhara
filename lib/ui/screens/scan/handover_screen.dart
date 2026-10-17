import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/haptics.dart';
import '../../../state/items_controller.dart';

/// The sender's side of a handover: shows the token as a QR code to be scanned.
///
/// The items are already locked server-side by the time this opens, and the
/// token expires in about 90 seconds. Credits for a return leg are minted when
/// the *receiver* claims, so this screen polls to learn the outcome — there is
/// no callback from the other phone.
class HandoverScreen extends ConsumerStatefulWidget {
  const HandoverScreen({super.key, required this.token});

  final HandoverToken token;

  static Future<void> push(BuildContext context, HandoverToken token) {
    return Navigator.of(context).push<void>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => HandoverScreen(token: token),
      ),
    );
  }

  @override
  ConsumerState<HandoverScreen> createState() => _HandoverScreenState();
}

class _HandoverScreenState extends ConsumerState<HandoverScreen> {
  Timer? _ticker;
  Duration _left = Duration.zero;
  bool _completed = false;
  bool _expired = false;

  HandoverToken get _token => widget.token;

  @override
  void initState() {
    super.initState();
    _left = _token.remaining;

    // Keep the screen bright: the receiver has to be able to read the QR code.
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

    _ticker = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      final left = _token.remaining;
      setState(() => _left = left);
      if (left == Duration.zero) timer.cancel();
    });

    _watch();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  /// Waits for the items to leave this user's hands.
  Future<void> _watch() async {
    final moved = await ref
        .read(itemsControllerProvider.notifier)
        .awaitHandover(_token);

    if (!mounted) return;

    if (moved) {
      Haptics.celebrate();
      setState(() => _completed = true);
      // Let the confirmation land before returning to the scanner.
      await Future<void>.delayed(const Duration(milliseconds: 1600));
      if (mounted) Navigator.of(context).pop();
    } else {
      Haptics.warn();
      setState(() => _expired = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.forestInk,
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: IconButton(
                icon: const Icon(Icons.close_rounded, color: Colors.white),
                onPressed: () {
                  Haptics.tap();
                  Navigator.of(context).pop();
                },
              ),
            ),
            Expanded(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: _completed
                      ? const _HandoverDone()
                      : _pending(context),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _pending(BuildContext context) {
    return Column(
      children: [
        Text(
          _expired ? 'Code expired' : 'Show this to the receiver',
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 21,
            fontWeight: FontWeight.w800,
          ),
        ).animate().fadeIn().slideY(begin: 0.2, end: 0),
        const SizedBox(height: 8),
        Text(
          _expired
              ? 'Nobody scanned it in time. Your items were released, so you can '
                  'start the handover again.'
              : 'They scan it from their Dhara app to take custody of '
                  '${_token.itemCount == 1 ? 'this item' : 'these ${_token.itemCount} items'}.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.7),
            fontSize: 13,
            height: 1.45,
            fontWeight: FontWeight.w600,
          ),
        ).animate(delay: 80.ms).fadeIn(),
        const SizedBox(height: 26),

        // White backing and near-black modules: a tinted or transparent QR is
        // measurably harder for a scanner to lock onto.
        AnimatedOpacity(
          opacity: _expired ? 0.25 : 1,
          duration: const Duration(milliseconds: 300),
          child: Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(26),
            ),
            child: QrImageView(
              data: _token.token,
              size: 226,
              backgroundColor: Colors.white,
              errorCorrectionLevel: QrErrorCorrectLevel.Q,
              eyeStyle: const QrEyeStyle(
                eyeShape: QrEyeShape.square,
                color: AppColors.forestDeep,
              ),
              dataModuleStyle: const QrDataModuleStyle(
                dataModuleShape: QrDataModuleShape.square,
                color: AppColors.forestDeep,
              ),
            ),
          ),
        )
            .animate(delay: 140.ms)
            .scale(duration: 420.ms, curve: Curves.easeOutBack)
            .fadeIn(),

        const SizedBox(height: 20),

        if (_expired)
          FilledButton(
            onPressed: () {
              Haptics.press();
              Navigator.of(context).pop();
            },
            style: FilledButton.styleFrom(minimumSize: const Size(220, 50)),
            child: const Text('Back to scanner'),
          ).animate().fadeIn()
        else
          _Countdown(left: _left, total: const Duration(seconds: 90)),

        const SizedBox(height: 22),
        _RouteChip(token: _token),

        const SizedBox(height: 18),
        SelectableText(
          _token.token,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.5),
            fontSize: 12,
            letterSpacing: 1.6,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'They can type this code if the camera will not read it.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.35),
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _Countdown extends StatelessWidget {
  const _Countdown({required this.left, required this.total});

  final Duration left;
  final Duration total;

  @override
  Widget build(BuildContext context) {
    final seconds = left.inSeconds;
    final urgent = seconds <= 20;
    final progress = total.inMilliseconds == 0
        ? 0.0
        : (left.inMilliseconds / total.inMilliseconds).clamp(0.0, 1.0);

    return Column(
      children: [
        SizedBox(
          width: 200,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 6,
              backgroundColor: Colors.white.withValues(alpha: 0.15),
              valueColor: AlwaysStoppedAnimation(
                urgent ? AppColors.amber : AppColors.lime,
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 1.8,
                color: Colors.white.withValues(alpha: 0.6),
              ),
            ),
            const SizedBox(width: 9),
            Text(
              'Waiting \u00B7 expires in ${seconds}s',
              style: TextStyle(
                color: urgent
                    ? AppColors.amber
                    : Colors.white.withValues(alpha: 0.75),
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _RouteChip extends StatelessWidget {
  const _RouteChip({required this.token});

  final HandoverToken token;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            token.fromState.label,
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 8),
            child: Icon(
              Icons.arrow_forward_rounded,
              size: 14,
              color: AppColors.lime,
            ),
          ),
          Text(
            token.toState.label,
            style: const TextStyle(
              color: AppColors.lime,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    ).animate(delay: 220.ms).fadeIn();
  }
}

class _HandoverDone extends StatelessWidget {
  const _HandoverDone();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 96,
          height: 96,
          decoration: BoxDecoration(
            color: AppColors.green.withValues(alpha: 0.2),
            shape: BoxShape.circle,
          ),
          child: const Center(
            child: Icon(
              Icons.check_rounded,
              color: AppColors.lime,
              size: 46,
            ),
          ),
        ).animate().scale(duration: 500.ms, curve: Curves.easeOutBack).fadeIn(),
        const SizedBox(height: 22),
        const Text(
          'Handover complete',
          style: TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.w800,
          ),
        ).animate(delay: 120.ms).fadeIn(),
        const SizedBox(height: 8),
        Text(
          'The items are on their way back up the chain.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.7),
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ).animate(delay: 180.ms).fadeIn(),
      ],
    );
  }
}
