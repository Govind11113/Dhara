import '../../data/models/tree.dart';

/// One height reading.
class GrowthPoint {
  const GrowthPoint(this.at, this.heightCm);

  final DateTime at;
  final int heightCm;
}

/// The readings worth charting, oldest first.
///
/// Only approved check-ins count: a held or rejected one has not been accepted
/// as true. A zero height means "not entered", not a tree of no height. Two
/// readings on the same calendar day collapse to the later one, so a retry does
/// not draw a spike.
List<GrowthPoint> growthPoints(List<TreeVerification> rows) {
  final approved = rows
      .where((r) => r.status == VerificationStatus.approved && r.heightCm > 0)
      .toList()
    ..sort((a, b) => a.verifiedAt.compareTo(b.verifiedAt));

  final byDay = <String, GrowthPoint>{};
  for (final r in approved) {
    final d = r.verifiedAt.toLocal();
    final key = '${d.year}-${d.month}-${d.day}';
    byDay[key] = GrowthPoint(r.verifiedAt, r.heightCm);
  }
  return byDay.values.toList();
}

/// A one-line summary of growth across the readings, or null with fewer than two.
///
/// Heights are typed in by the owner, so a fall is reported as such instead of
/// being dressed up as growth.
String? growthSummary(List<GrowthPoint> points) {
  if (points.length < 2) return null;
  final first = points.first;
  final last = points.last;
  final diff = last.heightCm - first.heightCm;
  final months = last.at.difference(first.at).inDays / 30.4;
  final span = months < 1.5 ? 'since the first check-in' : 'over ${months.round()} months';

  if (diff > 0) {
    final perMonth = months >= 1.5 ? ', about ${(diff / months).round()} cm a month' : '';
    return 'Grew $diff cm $span$perMonth.';
  }
  if (diff == 0) return 'No change in height $span.';
  return 'Recorded ${-diff} cm shorter $span. Heights are measured by hand, so '
      'small differences are normal.';
}
