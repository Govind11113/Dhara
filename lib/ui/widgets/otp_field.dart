import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_colors.dart';
import '../../core/utils/haptics.dart';

/// Six-box code entry.
///
/// A single real [TextField] sits transparently on top of the boxes rather than
/// one field per digit: the OS then handles paste, autofill of the SMS/email
/// code, and backspace correctly, none of which behave well across six separate
/// focus nodes.
class OtpField extends StatefulWidget {
  const OtpField({
    super.key,
    required this.controller,
    this.length = 6,
    this.onCompleted,
    this.autofocus = true,
    this.hasError = false,
  });

  final TextEditingController controller;
  final int length;
  final ValueChanged<String>? onCompleted;
  final bool autofocus;
  final bool hasError;

  @override
  State<OtpField> createState() => _OtpFieldState();
}

class _OtpFieldState extends State<OtpField> {
  final _focus = FocusNode();
  int _lastLength = 0;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChanged);
    _focus.dispose();
    super.dispose();
  }

  void _onChanged() {
    final text = widget.controller.text;
    if (text.length != _lastLength) {
      // Only tick on new digits, so holding backspace stays quiet.
      if (text.length > _lastLength) Haptics.select();
      _lastLength = text.length;
      setState(() {});
    }
    if (text.length == widget.length) {
      _focus.unfocus();
      widget.onCompleted?.call(text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.controller.text;

    return GestureDetector(
      onTap: () {
        Haptics.tap();
        _focus.requestFocus();
      },
      child: Stack(
        alignment: Alignment.center,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(widget.length, (i) {
              final filled = i < text.length;
              final isNext = i == text.length && _focus.hasFocus;

              return AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                curve: Curves.easeOut,
                width: 46,
                height: 56,
                margin: const EdgeInsets.symmetric(horizontal: 4),
                decoration: BoxDecoration(
                  color: filled ? AppColors.surfaceMuted : AppColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: widget.hasError
                        ? AppColors.danger
                        : isNext
                            ? AppColors.green
                            : filled
                                ? AppColors.sage
                                : AppColors.outline,
                    width: isNext || widget.hasError ? 2 : 1.4,
                  ),
                ),
                alignment: Alignment.center,
                child: Text(
                  filled ? text[i] : '',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.forest,
                      ),
                ),
              );
            }),
          ),
          // The transparent field that actually receives keystrokes.
          Positioned.fill(
            child: TextField(
              controller: widget.controller,
              focusNode: _focus,
              autofocus: widget.autofocus,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.oneTimeCode],
              maxLength: widget.length,
              showCursor: false,
              enableInteractiveSelection: false,
              style: const TextStyle(color: Colors.transparent, fontSize: 1),
              cursorColor: Colors.transparent,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                counterText: '',
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                filled: false,
                contentPadding: EdgeInsets.zero,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
