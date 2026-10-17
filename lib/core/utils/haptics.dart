import 'package:flutter/services.dart';

/// Centralised haptics so feedback stays consistent across the app.
///
/// Android has no native "success"/"error" pattern, so those are built from
/// short impact bursts.
class Haptics {
  const Haptics._();

  static Future<void> tap() => HapticFeedback.lightImpact();

  static Future<void> press() => HapticFeedback.mediumImpact();

  static Future<void> thud() => HapticFeedback.heavyImpact();

  static Future<void> select() => HapticFeedback.selectionClick();

  static Future<void> success() async {
    await HapticFeedback.lightImpact();
    await Future<void>.delayed(const Duration(milliseconds: 90));
    await HapticFeedback.mediumImpact();
  }

  /// Two sharp taps: used when a scan or verification is rejected.
  static Future<void> error() async {
    await HapticFeedback.heavyImpact();
    await Future<void>.delayed(const Duration(milliseconds: 110));
    await HapticFeedback.heavyImpact();
  }

  /// Rising triple-tap for credit awards and level ups.
  static Future<void> celebrate() async {
    await HapticFeedback.lightImpact();
    await Future<void>.delayed(const Duration(milliseconds: 80));
    await HapticFeedback.mediumImpact();
    await Future<void>.delayed(const Duration(milliseconds: 80));
    await HapticFeedback.heavyImpact();
  }

  static Future<void> warn() async {
    await HapticFeedback.mediumImpact();
    await Future<void>.delayed(const Duration(milliseconds: 70));
    await HapticFeedback.lightImpact();
  }
}
