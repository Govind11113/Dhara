import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/feedback.dart';
import '../../../state/feedback_controller.dart';
import '../../widgets/camera_capture.dart';
import '../../widgets/common.dart';

/// Lets a user tell us something.
///
/// [refType] and [refId] are optional so this can also be opened from a
/// rejected submission — a user disputing an automated decision arrives with
/// the reference already attached, instead of having to describe which tree
/// they mean.
class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({
    super.key,
    this.initialCategory,
    this.refType,
    this.refId,
  });

  final FeedbackCategory? initialCategory;
  final String? refType;
  final String? refId;

  static Future<void> push(
    BuildContext context, {
    FeedbackCategory? category,
    String? refType,
    String? refId,
  }) {
    Haptics.press();
    return Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => FeedbackScreen(
          initialCategory: category,
          refType: refType,
          refId: refId,
        ),
      ),
    );
  }

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  static const _minLength = 10;
  static const _maxLength = 2000;

  final _message = TextEditingController();

  late FeedbackCategory _category =
      widget.initialCategory ?? FeedbackCategory.bug;

  String? _screenshotPath;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    // Drives the live character count and the submit button's enabled state.
    _message.addListener(_onChanged);
  }

  @override
  void dispose() {
    _message.removeListener(_onChanged);
    _message.dispose();
    super.dispose();
  }

  void _onChanged() => setState(() {});

  /// Mirrors the server's own rule so the user is told before a round trip.
  bool get _canSend =>
      _message.text.trim().length >= _minLength && !_sending;

  Future<void> _attach() async {
    final path = await CameraCaptureScreen.push(
      context,
      title: 'Attach a photo',
      hint: 'Photograph the screen or the thing you are reporting.',
    );
    if (path != null && mounted) setState(() => _screenshotPath = path);
  }

  Future<void> _send() async {
    if (!_canSend) return;
    setState(() => _sending = true);

    try {
      await ref.read(feedbackControllerProvider.notifier).submit(
            category: _category.wire,
            message: _message.text.trim(),
            screenshotPath: _screenshotPath,
            refType: widget.refType,
            refId: widget.refId,
          );

      if (!mounted) return;
      Haptics.success();
      Navigator.of(context).pop();
      showSnack(context, 'Thanks — we have got it.');
    } catch (e) {
      if (!mounted) return;
      Haptics.error();
      setState(() => _sending = false);
      showSnack(context, friendlyMessage(e), isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final length = _message.text.trim().length;

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: const Text('Send feedback'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: _sending
              ? null
              : () {
                  Haptics.tap();
                  Navigator.of(context).pop();
                },
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            Text(
              'What is on your mind?',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: AppColors.forest,
                  ),
            ).animate().fadeIn().slideY(begin: 0.2, end: 0),
            const SizedBox(height: 6),
            const Text(
              'A real person reads every note. Be as specific as you like.',
              style: TextStyle(
                fontSize: 13,
                height: 1.45,
                fontWeight: FontWeight.w500,
                color: AppColors.inkSoft,
              ),
            ).animate(delay: 80.ms).fadeIn(),
            const SizedBox(height: 22),

            ...FeedbackCategory.values.map(
              (c) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: DharaCard(
                  onTap: _sending
                      ? null
                      : () {
                          Haptics.select();
                          setState(() => _category = c);
                        },
                  color: _category == c
                      ? AppColors.limeSoft
                      : AppColors.surface,
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Text(c.emoji, style: const TextStyle(fontSize: 19)),
                      const SizedBox(width: 13),
                      Expanded(
                        child: Text(
                          c.label,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: AppColors.forest,
                          ),
                        ),
                      ),
                      AnimatedScale(
                        scale: _category == c ? 1 : 0,
                        duration: const Duration(milliseconds: 200),
                        curve: Curves.easeOutBack,
                        child: const Icon(
                          Icons.check_circle_rounded,
                          color: AppColors.green,
                          size: 21,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: 12),
            TextField(
              controller: _message,
              enabled: !_sending,
              maxLines: 6,
              minLines: 4,
              maxLength: _maxLength,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                labelText: 'Tell us more',
                alignLabelWithHint: true,
                hintText: _category == FeedbackCategory.verificationDispute
                    ? 'Which tree was it, and what happened?'
                    : 'What were you doing when it went wrong?',
                helperText: length < _minLength
                    ? 'At least $_minLength characters'
                    : null,
              ),
            ),

            const SizedBox(height: 6),
            if (_screenshotPath == null)
              OutlinedButton.icon(
                onPressed: _sending ? null : _attach,
                icon: const Icon(Icons.add_a_photo_outlined, size: 18),
                label: const Text('Attach a photo (optional)'),
              )
            else
              Row(
                children: [
                  const Icon(
                    Icons.check_circle_rounded,
                    size: 18,
                    color: AppColors.green,
                  ),
                  const SizedBox(width: 9),
                  const Expanded(
                    child: Text(
                      'Photo attached',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.forest,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: _sending
                        ? null
                        : () => setState(() => _screenshotPath = null),
                    child: const Text('Remove'),
                  ),
                ],
              ),

            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _canSend ? _send : null,
              icon: _sending
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_rounded, size: 18),
              label: Text(_sending ? 'Sending\u2026' : 'Send'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Your app version and device model are attached automatically so '
              'we can reproduce the problem.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                height: 1.4,
                fontWeight: FontWeight.w600,
                color: AppColors.inkFaint,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
