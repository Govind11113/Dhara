import 'package:dhara/core/utils/tree_co2.dart';
import 'package:dhara/data/models/tree.dart';
import 'package:flutter_test/flutter_test.dart';

Species sp(String code, int grams) => Species(code: code, name: code, co2PerYearGrams: grams);

Tree tree(String species, {TreeStatus status = TreeStatus.alive}) => Tree(
      id: 't-$species-${status.name}',
      ownerId: 'u',
      speciesCode: species,
      speciesName: species,
      lat: 0,
      lng: 0,
      plantedAt: DateTime(2026, 1, 1),
      status: status,
    );

final table = [
  sp('neem', 21000),
  sp('peepal', 27000),
  sp('bamboo', 30000),
  sp('other', 15000),
];

void main() {
  group('average tree', () {
    test('is the mean of the real species', () {
      final r = computeTreeCo2(table, const [])!;
      expect(r.avgKgPerYear, closeTo(26.0, 1e-9)); // (21+27+30)/3
    });

    // "Other" means "not sure what it is". Counting it would drag the average
    // toward a number that describes no actual tree.
    test('leaves the catch-all species out of the average', () {
      final withOther = computeTreeCo2(table, const [])!;
      final without = computeTreeCo2(table.where((s) => s.code != 'other').toList(), const [])!;
      expect(withOther.avgKgPerYear, without.avgKgPerYear);
    });

    test('matches the seeded species table', () {
      final seeded = [
        sp('neem', 21000), sp('peepal', 27000), sp('banyan', 29000), sp('mango', 20000),
        sp('guava', 15000), sp('gulmohar', 18000), sp('ashoka', 14000), sp('jamun', 22000),
        sp('bamboo', 30000), sp('coconut', 16000), sp('other', 15000),
      ];
      final r = computeTreeCo2(seeded, const [])!;
      expect(r.avgKgPerYear, closeTo(21.2, 1e-9));
      expect(r.avgGramsPerDay, closeTo(58.08, 0.01));
    });

    test('ignores species with no figure', () {
      final r = computeTreeCo2([sp('neem', 20000), sp('mystery', 0)], const [])!;
      expect(r.avgKgPerYear, 20);
    });

    test('is null when there is nothing to average', () {
      expect(computeTreeCo2(const [], const []), isNull);
      expect(computeTreeCo2([sp('other', 15000)], const []), isNull);
      expect(computeTreeCo2([sp('neem', 0)], const []), isNull);
    });
  });

  group("the member's own trees", () {
    test('adds up each living tree by its own species', () {
      final r = computeTreeCo2(table, [tree('neem'), tree('bamboo'), tree('neem')])!;
      expect(r.myLivingTrees, 3);
      expect(r.myKgPerYear, closeTo(72, 1e-9)); // 21 + 30 + 21
    });

    test('counts a tree that needs a check-in, which is still alive', () {
      final r = computeTreeCo2(table, [tree('neem', status: TreeStatus.atRisk)])!;
      expect(r.myLivingTrees, 1);
    });

    test('does not count trees in review, rejected, missed or dead', () {
      final r = computeTreeCo2(table, [
        tree('neem', status: TreeStatus.pendingReview),
        tree('neem', status: TreeStatus.rejected),
        tree('neem', status: TreeStatus.missed),
        tree('neem', status: TreeStatus.dead),
      ])!;
      expect(r.myLivingTrees, 0);
      expect(r.myKgPerYear, 0);
    });

    // Falling back to zero would undercount without anyone noticing.
    test('an unknown species uses the average, not zero', () {
      final r = computeTreeCo2(table, [tree('baobab')])!;
      expect(r.myKgPerYear, closeTo(26, 1e-9));
    });

    test('the catch-all species still counts for the member who picked it', () {
      final r = computeTreeCo2(table, [tree('other')])!;
      expect(r.myKgPerYear, closeTo(15, 1e-9));
    });

    test('no trees is zero, not null', () {
      final r = computeTreeCo2(table, const [])!;
      expect((r.myLivingTrees, r.myKgPerYear), (0, 0));
    });
  });

  group('formatKg', () {
    test('uses whole kilograms from ten up and one decimal below', () {
      expect(formatKg(21.2), '21 kg');
      expect(formatKg(10), '10 kg');
      expect(formatKg(9.96), '10 kg');
      expect(formatKg(4.5), '4.5 kg');
      expect(formatKg(0.8), '0.8 kg');
    });

    test('drops a pointless .0 and handles zero and negatives', () {
      expect(formatKg(5.0), '5 kg');
      expect(formatKg(0), '0 kg');
      expect(formatKg(-3), '0 kg');
    });
  });

  group('formatCo2', () {
    test('kilograms below a tonne, tonnes from a tonne up', () {
      expect(formatCo2(820), '820 kg');
      expect(formatCo2(999), '999 kg');
      expect(formatCo2(1000), '1 t');
      expect(formatCo2(1881), '1.9 t');
      expect(formatCo2(2201), '2.2 t');
      expect(formatCo2(4729), '4.7 t');
      expect(formatCo2(12400), '12 t');
    });

    test('zero and negatives read as zero', () {
      expect(formatCo2(0), '0 kg');
      expect(formatCo2(-5), '0 kg');
    });
  });
}
