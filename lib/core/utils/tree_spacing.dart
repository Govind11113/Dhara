/// How close a new tree may be planted to an existing one.
///
/// Mirrors functions/api/src/lib/tree_spacing.js. The limit is the app_config
/// key `tree.min_spacing_cm`, a whole number of centimetres, 30 by default.
/// Exactly the limit is allowed; only closer is refused. The server enforces
/// it; the app uses the same rule for its warning and map ring.
class TreeSpacing {
  const TreeSpacing._();

  static const configKey = 'tree.min_spacing_cm';
  static const defaultCm = 30;

  /// 50 m. Anything above this is treated as a typo, not a policy.
  static const maxCm = 5000;

  // Distance arithmetic is not exact: a spot 30 cm away can come out as
  // 29.9999999 cm. A micrometre of tolerance keeps "exactly the limit" allowed.
  static const _toleranceCm = 1e-4;

  /// The configured limit, or [defaultCm] when [raw] is missing, not a whole
  /// number, negative or implausibly large.
  static int parseCm(Object? raw) {
    if (raw == null) return defaultCm;
    final n = raw is num ? raw : num.tryParse('$raw'.trim());
    if (n == null || !n.isFinite || n != n.roundToDouble()) return defaultCm;
    final cm = n.toInt();
    if (cm < 0 || cm > maxCm) return defaultCm;
    return cm;
  }

  /// Whether a tree [distanceM] metres from another is too close to register.
  static bool tooClose(double distanceM, {int minCm = defaultCm}) =>
      distanceM.isFinite && distanceM * 100 < minCm - _toleranceCm;

  /// "12 cm" below one metre, "4 m" from one metre up.
  static String formatDistance(double distanceM) {
    final cm = (distanceM * 100).round();
    if (cm < 100) return '${cm < 0 ? 0 : cm} cm';
    return '${distanceM.round()} m';
  }

  /// A limit in centimetres: "30 cm", "1 m", "1.5 m".
  static String formatSpacing(int cm) {
    if (cm < 100) return '$cm cm';
    final m = cm / 100;
    return m == m.roundToDouble()
        ? '${m.round()} m'
        : '${m.toStringAsFixed(2).replaceFirst(RegExp(r'0+$'), '')} m';
  }
}
