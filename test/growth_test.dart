import 'package:dhara/core/utils/growth.dart';
import 'package:dhara/data/models/tree.dart';
import 'package:flutter_test/flutter_test.dart';

TreeVerification v(
  DateTime at,
  int height, {
  VerificationStatus status = VerificationStatus.approved,
  String id = '',
}) =>
    TreeVerification(
      id: id.isEmpty ? '$at$height' : id,
      treeId: 't',
      monthKey: '${at.year}-${at.month}',
      status: status,
      verifiedAt: at,
      heightCm: height,
    );

void main() {
  group('growthPoints', () {
    test('keeps approved readings, oldest first, whatever order they arrive in', () {
      final pts = growthPoints([
        v(DateTime(2026, 4, 5), 80),
        v(DateTime(2026, 2, 5), 40),
        v(DateTime(2026, 3, 5), 60),
      ]);
      expect(pts.map((p) => p.heightCm), [40, 60, 80]);
    });

    test('ignores held and rejected check-ins', () {
      final pts = growthPoints([
        v(DateTime(2026, 2, 5), 40),
        v(DateTime(2026, 3, 5), 500, status: VerificationStatus.manualReview),
        v(DateTime(2026, 4, 5), 900, status: VerificationStatus.rejected),
      ]);
      expect(pts.map((p) => p.heightCm), [40]);
    });

    test('a height of zero means "not entered", not a flat tree', () {
      final pts = growthPoints([v(DateTime(2026, 2, 5), 0), v(DateTime(2026, 3, 5), 50)]);
      expect(pts.map((p) => p.heightCm), [50]);
    });

    test('two readings on the same day collapse to the later one', () {
      final pts = growthPoints([
        v(DateTime(2026, 2, 5, 9), 40),
        v(DateTime(2026, 2, 5, 17), 44),
      ]);
      expect(pts.map((p) => p.heightCm), [44]);
    });

    test('nothing in, nothing out', () {
      expect(growthPoints(const []), isEmpty);
    });
  });

  group('growthSummary', () {
    GrowthPoint p(DateTime at, int h) => GrowthPoint(at, h);

    test('needs two readings', () {
      expect(growthSummary([]), isNull);
      expect(growthSummary([p(DateTime(2026, 1, 1), 30)]), isNull);
    });

    test('reports growth with a monthly rate once there are months to speak of', () {
      final s = growthSummary([p(DateTime(2026, 1, 1), 30), p(DateTime(2026, 7, 1), 90)]);
      expect(s, 'Grew 60 cm over 6 months, about 10 cm a month.');
    });

    test('a short span has no rate, which would be noise', () {
      final s = growthSummary([p(DateTime(2026, 1, 1), 30), p(DateTime(2026, 1, 20), 34)]);
      expect(s, 'Grew 4 cm since the first check-in.');
    });

    test('no change is said plainly', () {
      expect(growthSummary([p(DateTime(2026, 1, 1), 30), p(DateTime(2026, 5, 1), 30)]), startsWith('No change in height'));
    });

    // Heights are typed by hand, so a fall is reported as one, not as growth.
    test('a fall is reported honestly, with a reason it can happen', () {
      final s = growthSummary([p(DateTime(2026, 1, 1), 50), p(DateTime(2026, 5, 1), 45)])!;
      expect(s, startsWith('Recorded 5 cm shorter'));
      expect(s, contains('measured by hand'));
      expect(s, isNot(contains('Grew')));
    });
  });
}
