import 'package:dhara/core/services/location.dart';
import 'package:dhara/core/utils/tree_spacing.dart';
import 'package:dhara/data/models/tree.dart';
import 'package:dhara/data/repository.dart';
import 'package:dhara/state/trees_controller.dart';
import 'package:dhara/ui/screens/trees/plant_tree_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_location_backend.dart';

// The distances the planting rule must get right. Exactly 30 cm is allowed.
const _cases = <(double, bool)>[
  (0.10, true),
  (0.29, true),
  (0.30, false),
  (0.31, false),
  (0.50, false),
  (1.0, false),
  (3.0, false),
];

// Where FakeLocationBackend's default reading puts the phone.
const _lat = 12.9716;
const _lng = 77.5946;
const _mPerDegLat = 6371000 * 3.141592653589793 / 180;

class _TreesAt extends TreesController {
  _TreesAt(this.trees);
  final List<Tree> trees;

  @override
  Future<List<Tree>> build() async => trees;
}

/// A neem [metres] due south of where the phone reports itself.
Tree _treeSouth(double metres) => Tree.fromMap({
  r'$id': 't1',
  'ownerId': 'u1',
  'speciesCode': 'neem',
  'speciesName': 'Neem',
  'nickname': 'Gate neem',
  'lat': _lat - metres / _mPerDegLat,
  'lng': _lng,
  'status': 'active',
});

class _Repo implements Repository {
  _Repo({this.value, this.error});
  final String? value;
  final Object? error;

  @override
  Future<String?> configValue(String key) async {
    expect(key, 'tree.min_spacing_cm');
    if (error != null) throw error!;
    return value;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _neem = Species(
  code: 'neem',
  name: 'Neem',
  creditsPerVerification: 12,
  co2PerYearGrams: 21000,
);

Future<void> _openLocationStep(
  WidgetTester tester, {
  required Tree existing,
  int minCm = 30,
}) async {
  tester.view.physicalSize = const Size(1200, 3600);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  final phone = FakeLocationBackend();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        locationServiceProvider.overrideWithValue(
          LocationService(backend: phone),
        ),
        speciesProvider.overrideWith((ref) async => [_neem]),
        treesControllerProvider.overrideWith(() => _TreesAt([existing])),
        minTreeSpacingCmProvider.overrideWith((ref) async => minCm),
      ],
      child: const MaterialApp(home: PlantTreeScreen()),
    ),
  );
  await tester.pump(const Duration(seconds: 2));
  await tester.tap(find.text('Neem'));
  await tester.pump();
  await tester.tap(find.text('Next'));
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 200));
  }
}

Future<void> _finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 5));
}

final _warning = find.byKey(const Key('too-close-warning'));

void main() {
  group('the planting rule', () {
    test('closer than 30 cm is too close; 30 cm or more is allowed', () {
      expect(TreeSpacing.defaultCm, 30);
      for (final (d, refused) in _cases) {
        expect(TreeSpacing.tooClose(d), refused, reason: '$d m');
        expect(TreeSpacing.tooClose(d, minCm: 30), refused, reason: '$d m');
      }
    });

    test('a missing or invalid setting falls back to 30 cm', () {
      for (final raw in <Object?>[
        null,
        '',
        'abc',
        '-5',
        '12.5',
        '999999',
        double.nan,
      ]) {
        expect(TreeSpacing.parseCm(raw), 30, reason: '$raw');
      }
      expect(TreeSpacing.parseCm('45'), 45);
      expect(TreeSpacing.parseCm(45), 45);
      expect(TreeSpacing.parseCm('0'), 0);
    });

    test('distances under a metre are shown in centimetres', () {
      expect(TreeSpacing.formatDistance(0.12), '12 cm');
      expect(TreeSpacing.formatDistance(0.994), '99 cm');
      expect(TreeSpacing.formatDistance(0.996), '1 m');
      expect(TreeSpacing.formatDistance(4.2), '4 m');
      expect(TreeSpacing.formatSpacing(30), '30 cm');
      expect(TreeSpacing.formatSpacing(100), '1 m');
      expect(TreeSpacing.formatSpacing(150), '1.5 m');
    });
  });

  group('the setting the app reads', () {
    Future<int> read(Repository repo) async {
      final c = ProviderContainer(
        overrides: [repositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(c.dispose);
      return c.read(minTreeSpacingCmProvider.future);
    }

    test('uses the admin value when it is valid', () async {
      expect(await read(_Repo(value: '50')), 50);
    });

    test('falls back to 30 cm when missing, invalid or unreadable', () async {
      expect(await read(_Repo()), 30);
      expect(await read(_Repo(value: '0.3')), 30);
      expect(await read(_Repo(error: Exception('offline'))), 30);
    });
  });

  group('plant screen warning', () {
    for (final (d, refused) in _cases) {
      testWidgets('${(d * 100).round()} cm from a tree: '
          '${refused ? 'warns' : 'no warning'}', (tester) async {
        await _openLocationStep(tester, existing: _treeSouth(d));
        expect(_warning, refused ? findsOneWidget : findsNothing);
        await _finish(tester);
      });
    }

    testWidgets('the warning gives the distance and limit in centimetres', (
      tester,
    ) async {
      await _openLocationStep(tester, existing: _treeSouth(0.12));
      final text = tester.widget<Text>(_warning).data!;
      expect(text, contains('about 12 cm from "Gate neem"'));
      expect(text, contains('at least 30 cm apart'));
      await _finish(tester);
    });

    testWidgets('an admin-set limit is used by the app too', (tester) async {
      await _openLocationStep(tester, existing: _treeSouth(0.4), minCm: 50);
      expect(
        tester.widget<Text>(_warning).data,
        contains('at least 50 cm apart'),
      );
      await _finish(tester);
    });
  });
}
