import 'dart:convert';

import 'package:dhara/core/services/weather.dart';
import 'package:dhara/core/utils/growth.dart';
import 'package:dhara/data/models/tree.dart';
import 'package:dhara/state/trees_controller.dart';
import 'package:dhara/state/weather_controller.dart';
import 'package:dhara/ui/widgets/tree_care_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final _now = DateTime.now();

Tree tree({
  TreeStatus status = TreeStatus.alive,
  int ageDays = 100,
  String species = 'neem',
}) =>
    Tree(
      id: 't1', ownerId: 'u', speciesCode: species, speciesName: 'Neem',
      lat: 12.9716, lng: 77.5946, status: status,
      plantedAt: _now.subtract(Duration(days: ageDays)),
    );

/// A forecast for *today* wherever the tests run, with the given rain.
String forecastBody({List<double> rain = const [0, 0, 0, 0, 0, 0, 0], double high = 30}) {
  final today = DateTime.now().toUtc();
  String d(int off) {
    final x = today.add(Duration(days: off));
    return '${x.year}-${x.month.toString().padLeft(2, '0')}-${x.day.toString().padLeft(2, '0')}';
  }

  return jsonEncode({
    'utc_offset_seconds': 0,
    'daily': {
      'time': [for (var i = -3; i <= 3; i++) d(i)],
      'precipitation_sum': rain,
      'temperature_2m_max': List.filled(7, high),
    },
  });
}

const _species = [Species(code: 'neem', name: 'Neem', careTip: 'Hardy and drought tolerant. Water twice a week for the first year.')];

class _NoTrees extends TreesController {
  @override
  Future<List<Tree>> build() async => const [];
}

List<Override> overrides(Future<http.Response> Function() answer, {List<Species> species = _species}) => [
      weatherServiceProvider.overrideWithValue(WeatherService(client: MockClient((_) => answer()))),
      speciesProvider.overrideWith((ref) async => species),
      treesControllerProvider.overrideWith(_NoTrees.new),
    ];

Future<void> show(WidgetTester tester, Widget child, List<Override> o) async {
  tester.view.physicalSize = const Size(1000, 3000);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(overrides: o, child: MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child)))));
  await tester.pump(const Duration(milliseconds: 50));
  await tester.pump(const Duration(milliseconds: 300));
}

Future<void> finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 5));
}

TreeVerification ver(DateTime at, int h, {VerificationStatus s = VerificationStatus.approved}) =>
    TreeVerification(id: '$at', treeId: 't1', monthKey: '${at.year}-${at.month}', status: s, verifiedAt: at, heightCm: h);

void main() {
  group('who gets a watering tip', () {
    test('a young living tree does', () {
      expect(needsCareTip(tree()), isTrue);
      expect(needsCareTip(tree(status: TreeStatus.atRisk)), isTrue);
      expect(needsCareTip(tree(ageDays: kYoungTreeDays - 1)), isTrue);
    });

    test('an established tree does not', () {
      expect(needsCareTip(tree(ageDays: kYoungTreeDays)), isFalse);
      expect(needsCareTip(tree(ageDays: 2000)), isFalse);
    });

    test('a dead, rejected or still-in-review tree does not', () {
      for (final s in [TreeStatus.dead, TreeStatus.rejected, TreeStatus.pendingReview, TreeStatus.missed]) {
        expect(needsCareTip(tree(status: s)), isFalse, reason: s.name);
      }
    });
  });

  group('TreeCareCard', () {
    testWidgets('says to skip watering when rain is coming, and names the species note', (tester) async {
      await show(
        tester,
        TreeCareCard(tree: tree()),
        overrides(() async => http.Response(forecastBody(rain: [0, 0, 0, 4, 4, 0, 0]), 200)),
      );

      expect(find.text('Rain is on the way'), findsOneWidget);
      expect(find.textContaining('8.0 mm'), findsOneWidget);
      expect(find.textContaining('Neem: Hardy and drought tolerant'), findsOneWidget);
      expect(find.textContaining('Open-Meteo.com'), findsOneWidget);
      expect(find.textContaining('not advice for this tree'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('says to water when it is hot and dry', (tester) async {
      await show(
        tester,
        TreeCareCard(tree: tree()),
        overrides(() async => http.Response(forecastBody(high: 38), 200)),
      );
      expect(find.text('Hot and dry: water today'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('shows nothing at all for an established tree, and makes no request', (tester) async {
      var calls = 0;
      await show(
        tester,
        TreeCareCard(tree: tree(ageDays: 900)),
        overrides(() async {
          calls++;
          return http.Response(forecastBody(), 200);
        }),
      );
      expect(find.byType(Card), findsNothing);
      expect(find.textContaining('Open-Meteo'), findsNothing);
      expect(calls, 0);
      await finish(tester);
    });

    testWidgets('shows nothing for a dead tree', (tester) async {
      await show(tester, TreeCareCard(tree: tree(status: TreeStatus.dead)), overrides(() async => http.Response(forecastBody(), 200)));
      expect(find.textContaining('Open-Meteo'), findsNothing);
      await finish(tester);
    });

    testWidgets('a failure says so quietly and offers a retry that works', (tester) async {
      var healthy = false;
      await show(
        tester,
        TreeCareCard(tree: tree()),
        overrides(() async => healthy ? http.Response(forecastBody(high: 38), 200) : http.Response('x', 500)),
      );
      expect(find.text('Watering tip unavailable right now.'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      healthy = true;
      await tester.tap(find.text('Retry'));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Hot and dry: water today'), findsOneWidget);
      await finish(tester);
    });

    // The screen must not hang on "loading" when offline.
    testWidgets('offline it settles at once and does not retry in the background', (tester) async {
      var calls = 0;
      await show(
        tester,
        TreeCareCard(tree: tree()),
        overrides(() async {
          calls++;
          throw http.ClientException('offline');
        }),
      );
      expect(find.text('Watering tip unavailable right now.'), findsOneWidget);
      await tester.pump(const Duration(seconds: 30));
      expect(calls, 1);
      await finish(tester);
    });

    testWidgets('a tree\'s exact location is not sent, only its area', (tester) async {
      Uri? seen;
      await show(
        tester,
        TreeCareCard(tree: tree()),
        [
          weatherServiceProvider.overrideWithValue(WeatherService(client: MockClient((r) async {
            seen = r.url;
            return http.Response(forecastBody(), 200);
          }))),
          speciesProvider.overrideWith((ref) async => _species),
          treesControllerProvider.overrideWith(_NoTrees.new),
        ],
      );
      expect(seen?.queryParameters['latitude'], '13.0');
      expect(seen?.queryParameters['longitude'], '77.6');
      await finish(tester);
    });
  });

  group('GrowthCard', () {
    List<GrowthPoint> pts() => growthPoints([
          ver(DateTime(2026, 2, 5), 40),
          ver(DateTime(2026, 5, 5), 70),
          ver(DateTime(2026, 8, 5), 105),
        ]);

    testWidgets('draws a chart and a plain summary from two readings up', (tester) async {
      await show(tester, GrowthCard(points: pts()), const []);
      expect(find.text('Growth'), findsOneWidget);
      expect(find.textContaining('Grew 65 cm over 6 months'), findsOneWidget);
      expect(find.textContaining('what you entered'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('is absent for one reading or none', (tester) async {
      await show(tester, GrowthCard(points: growthPoints([ver(DateTime(2026, 2, 5), 40)])), const []);
      expect(find.text('Growth'), findsNothing);
      await show(tester, const GrowthCard(points: []), const []);
      expect(find.text('Growth'), findsNothing);
      await finish(tester);
    });

    testWidgets('a falling reading is reported as a fall', (tester) async {
      await show(tester, GrowthCard(points: growthPoints([ver(DateTime(2026, 2, 5), 50), ver(DateTime(2026, 6, 5), 44)])), const []);
      expect(find.textContaining('shorter'), findsOneWidget);
      expect(find.textContaining('Grew'), findsNothing);
      await finish(tester);
    });

    testWidgets('identical heights draw without a degenerate axis', (tester) async {
      await show(tester, GrowthCard(points: growthPoints([ver(DateTime(2026, 2, 5), 50), ver(DateTime(2026, 6, 5), 50)])), const []);
      expect(find.text('Growth'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await finish(tester);
    });

    testWidgets('readings a day apart draw without dividing by zero', (tester) async {
      await show(tester, GrowthCard(points: growthPoints([ver(DateTime(2026, 2, 5), 50), ver(DateTime(2026, 2, 6), 52)])), const []);
      expect(find.text('Growth'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await finish(tester);
    });
  });
}

