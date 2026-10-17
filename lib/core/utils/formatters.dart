import 'package:intl/intl.dart';

/// Display helpers. Kept in one place so numbers and dates read the same
/// everywhere in the app.
class Fmt {
  const Fmt._();

  static final _credits = NumberFormat.decimalPattern('en_IN');
  static final _rupees = NumberFormat.currency(
    locale: 'en_IN',
    symbol: '\u20B9',
    decimalDigits: 0,
  );
  static final _dayMonth = DateFormat('d MMM');
  static final _dayMonthYear = DateFormat('d MMM yyyy');
  static final _monthLabel = DateFormat('MMMM yyyy');
  static final _stampFormat = DateFormat('d MMM yyyy, HH:mm:ss');

  static String credits(num value) => _credits.format(value);

  static String rupees(num value) => _rupees.format(value);

  static String date(DateTime value) => _dayMonth.format(value.toLocal());

  static String fullDate(DateTime value) =>
      _dayMonthYear.format(value.toLocal());

  static String monthName(DateTime value) =>
      _monthLabel.format(value.toLocal());

  /// A GPS-stamp timestamp: date, time to the second, and the UTC offset.
  ///
  /// Seconds and the offset are both deliberate. This labels evidence, and
  /// "14:32" with no zone is ambiguous the moment the record is read anywhere
  /// else. The offset is computed from [DateTime.timeZoneOffset] rather than a
  /// DateFormat pattern because Dart's intl does not implement the timezone
  /// pattern characters.
  static String stamp(DateTime value) {
    final local = value.toLocal();
    return '${_stampFormat.format(local)} ${utcOffset(local)}';
  }

  static String utcOffset(DateTime value) {
    final offset = value.timeZoneOffset;
    final sign = offset.isNegative ? '-' : '+';
    final abs = offset.abs();
    final h = abs.inHours.toString().padLeft(2, '0');
    final m = abs.inMinutes.remainder(60).toString().padLeft(2, '0');
    return 'UTC$sign$h:$m';
  }

  /// Degrees, minutes, seconds — the notation a GPS receiver or a camera stamp
  /// uses. Kept alongside the decimal form rather than replacing it: decimal is
  /// what gets submitted and what a map accepts.
  ///
  /// Latitude runs to 90 and longitude to 180, so they pad to different widths.
  /// Both are zero-padded so the two lines align when stacked.
  static String latDms(double value) => _dms(value, 'N', 'S', 2);

  static String lngDms(double value) => _dms(value, 'E', 'W', 3);

  static String _dms(
    double value,
    String positive,
    String negative,
    int degreeDigits,
  ) {
    final hemisphere = value >= 0 ? positive : negative;

    // Rounded to tenths of an arcsecond *before* being split into parts.
    // Rounding each part on its own lets 59.97" print as "60.0", which is not
    // valid notation — the carry into minutes, and on into degrees, has to
    // happen while this is still a single number.
    var tenths = (value.abs() * 36000).round();
    final degrees = tenths ~/ 36000;
    tenths %= 36000;
    final minutes = tenths ~/ 600;
    final seconds = (tenths % 600) / 10;

    return '$hemisphere '
        '${degrees.toString().padLeft(degreeDigits, '0')}\u00B0 '
        '${minutes.toString().padLeft(2, '0')}\u2032 '
        '${seconds.toStringAsFixed(1).padLeft(4, '0')}\u2033';
  }

  /// CO2 arrives in grams because integers avoid float drift in the ledger.
  static String co2(int grams) {
    if (grams < 1000) return '$grams g';
    final kg = grams / 1000;
    if (kg < 1000) return '${kg.toStringAsFixed(kg < 10 ? 1 : 0)} kg';
    return '${(kg / 1000).toStringAsFixed(2)} t';
  }

  static String height(int cm) {
    if (cm < 100) return '$cm cm';
    return '${(cm / 100).toStringAsFixed(2)} m';
  }

  static String relative(DateTime value) {
    final now = DateTime.now();
    final diff = now.difference(value.toLocal());
    if (diff.isNegative) {
      final ahead = diff.abs();
      if (ahead.inMinutes < 60) return 'in ${ahead.inMinutes}m';
      if (ahead.inHours < 24) return 'in ${ahead.inHours}h';
      if (ahead.inDays == 1) return 'tomorrow';
      if (ahead.inDays < 30) return 'in ${ahead.inDays} days';
      return 'in ${(ahead.inDays / 30).round()} months';
    }
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return 'yesterday';
    if (diff.inDays < 30) return '${diff.inDays} days ago';
    if (diff.inDays < 365) return '${(diff.inDays / 30).round()} months ago';
    return '${(diff.inDays / 365).round()} years ago';
  }

  static String countdown(Duration d) {
    if (d.isNegative) return 'expired';
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    if (d.inHours > 0) return '${d.inHours}:$m:$s';
    return '$m:$s';
  }

  /// Ledger buckets a tree's monthly check-in by calendar month.
  static String monthKey([DateTime? when]) {
    final d = (when ?? DateTime.now()).toUtc();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}';
  }

  static String initials(String name) {
    final parts =
        name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';

    // Runes rather than [] so a leading emoji or Devanagari glyph is not split
    // into a broken surrogate half.
    String head(String s) => String.fromCharCode(s.runes.first).toUpperCase();

    if (parts.length == 1) return head(parts.first);
    return head(parts.first) + head(parts.last);
  }

  static String ordinal(int n) {
    if (n % 100 >= 11 && n % 100 <= 13) return '${n}th';
    switch (n % 10) {
      case 1:
        return '${n}st';
      case 2:
        return '${n}nd';
      case 3:
        return '${n}rd';
      default:
        return '${n}th';
    }
  }

  /// Masks all but the last four digits of a consumer number.
  static String maskConsumerNo(String value) {
    if (value.length <= 4) return value;
    return '${'\u2022' * (value.length - 4)}${value.substring(value.length - 4)}';
  }
}
