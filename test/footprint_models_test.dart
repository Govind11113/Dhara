import 'dart:convert';
import 'dart:io';

import 'package:dhara/data/models/footprint.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> fixture(String name) =>
    jsonDecode(File('test/fixtures/$name').readAsStringSync()) as Map<String, dynamic>;

void main() {
  group('against the server\'s real output', () {
    test('estimate: every figure the screen shows is read correctly', () {
      final r = FootprintResult.fromMap(fixture('footprint_estimate.json'));

      // The hand-checked case: 36.35 + 10.435 + 24.228 + 10.151 + 75.59.
      expect(r.monthKg, 156.8);
      expect(r.yearKg, 1881);
      expect(r.factorsVersion, '2026.1');
      expect(r.groups, {'electricity': 36.4, 'cooking': 10.4, 'transport': 34.4, 'air': 75.6});
      expect(r.comparison.indiaKgYear, 2201);
      expect(r.comparison.worldKgYear, 4729);
      expect(r.comparison.indiaYear, 2024);
      expect(r.comparison.ofIndia, 0.85);
    });

    test('lines arrive largest first, with confidence, and add up', () {
      final r = FootprintResult.fromMap(fixture('footprint_estimate.json'));
      expect(r.lines.first.key, 'flight_domestic');
      expect(r.lines.map((l) => l.kg), orderedEquals([...r.lines.map((l) => l.kg)]..sort((a, b) => b.compareTo(a))));
      expect(r.lines.fold<double>(0, (s, l) => s + l.share), closeTo(1, 0.01));
      expect(r.lines.every((l) => l.label.isNotEmpty && l.group.isNotEmpty), isTrue);
      expect(r.lines.firstWhere((l) => l.key == 'electricity').isApproximate, isFalse);
    });

    test('methodology: ten sourced factors, benchmarks, limits', () {
      final m = Methodology.fromMap(fixture('footprint_methodology.json'));
      expect(m.version, '2026.1');
      expect(m.factors, hasLength(10));
      expect(m.factors.every((f) => f.source.isNotEmpty && f.unit.isNotEmpty && f.note.isNotEmpty), isTrue);
      expect(m.factors.firstWhere((f) => f.key == 'electricity').value, 0.727);
      expect(m.factors.firstWhere((f) => f.key == 'electricity').confidence, 'high');
      expect(m.factors.firstWhere((f) => f.key == 'rail').confidence, 'low');
      expect(m.india.kgPerYear, 2201);
      expect(m.world.kgPerYear, 4729);
      expect(m.india.source, contains('Our World in Data'));
      expect(m.exclusions.any((e) => e.toLowerCase().contains('food')), isTrue);
      expect(m.caveats.any((c) => c.contains('never affects your credits')), isTrue);
    });
  });

  group('travel modes', () {
    // Must equal TRAVEL_MODES on the server (also pinned there), or a mode
    // could be offered here that the server rejects.
    test('are exactly the ones the server understands, in order', () {
      expect(kTravelModes.map((m) => m.key), [
        'car_petrol', 'car_diesel', 'motorbike', 'taxi', 'bus', 'rail',
        'flight_domestic', 'flight_international',
      ]);
    });

    test('each has a label and a unit', () {
      for (final m in kTravelModes) {
        expect(m.label, isNotEmpty);
        expect(m.unit, isNotEmpty);
      }
    });

    test('every mode in the methodology fixture is offered, and the reverse', () {
      final factors = Methodology.fromMap(fixture('footprint_methodology.json')).factors.map((f) => f.key).toSet();
      expect(factors.containsAll(kTravelModes.map((m) => m.key)), isTrue);
      expect(factors.difference(kTravelModes.map((m) => m.key).toSet()), {'electricity', 'lpg'});
    });
  });

  group('FootprintInputs', () {
    test('only trips actually taken are sent', () {
      const i = FootprintInputs(
        electricityKwh: 120,
        travel: {'bus': 40, 'rail': 0, 'car_petrol': 0},
      );
      expect(i.toJson()['travel'], {'bus': 40});
    });

    test('round-trips through JSON', () {
      const i = FootprintInputs(
        householdSize: 4, carOccupants: 2, electricityKwh: 210.5, lpgCylinders: 1,
        travel: {'car_petrol': 300, 'flight_domestic': 1000},
      );
      expect(FootprintInputs.fromJson(i.toJson()), i);
    });

    test('nothing entered has no activity; any one thing counts', () {
      expect(const FootprintInputs().hasActivity, isFalse);
      expect(const FootprintInputs(householdSize: 5).hasActivity, isFalse);
      expect(const FootprintInputs(lpgCylinders: 1).hasActivity, isTrue);
      expect(const FootprintInputs(travel: {'bus': 1}).hasActivity, isTrue);
    });

    test('a damaged stored copy degrades to safe values', () {
      final i = FootprintInputs.fromJson({
        'householdSize': 'many', 'carOccupants': 99, 'electricityKwh': 'x',
        'travel': {'bus': '12', 7: 3, 'taxi': null},
      });
      expect(i.householdSize, 1);
      expect(i.carOccupants, 8);
      expect(i.electricityKwh, 0);
      expect(i.travel['bus'], 12);
      expect(i.travel['taxi'], 0);
    });
  });

  group('FootprintEntry', () {
    Map<String, dynamic> row({Object? inputs, String month = '2026-10'}) => {
          r'$id': 'f1', 'monthKey': month, 'monthKg': 156.8, 'yearKg': 1881,
          'electricityKg': 36.4, 'cookingKg': 10.4, 'transportKg': 34.4, 'airKg': 75.6,
          'factorsVersion': '2026.1', 'inputs': inputs,
        };

    test('reads a stored row and its inputs', () {
      final e = FootprintEntry.fromMap(row(inputs: jsonEncode({'electricityKwh': 200, 'householdSize': 4})));
      expect(e.monthKg, 156.8);
      expect(e.inputs?.electricityKwh, 200);
      expect(e.inputs?.householdSize, 4);
      expect(e.label, 'Oct 2026');
      expect(e.shortLabel, 'Oct');
    });

    // Unreadable inputs must never hide a month's totals from the history.
    test('unreadable stored inputs still leave the totals', () {
      for (final bad in [null, '', 'not json', '[1,2]', 5]) {
        final e = FootprintEntry.fromMap(row(inputs: bad));
        expect(e.inputs, isNull, reason: '$bad');
        expect(e.monthKg, 156.8);
      }
    });

    test('a malformed month key shows as-is instead of throwing', () {
      final e = FootprintEntry.fromMap(row(month: 'oops'));
      expect(e.month, isNull);
      expect(e.label, 'oops');
    });

    test('an empty row parses to zeros', () {
      final e = FootprintEntry.fromMap({r'$id': 'x'});
      expect((e.monthKg, e.airKg, e.monthKey), (0.0, 0.0, ''));
    });
  });

  test('a response with missing pieces parses without throwing', () {
    final r = FootprintResult.fromMap({'monthKg': 12});
    expect(r.monthKg, 12);
    expect(r.lines, isEmpty);
    expect(r.groups, isEmpty);
    expect(Methodology.fromMap({}).factors, isEmpty);
  });
}
