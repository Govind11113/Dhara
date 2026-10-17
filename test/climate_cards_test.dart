import 'dart:convert';

import 'package:dhara/core/services/air_quality.dart';
import 'package:dhara/core/services/location.dart';
import 'package:dhara/data/models/tree.dart';
import 'package:dhara/state/air_controller.dart';
import 'package:dhara/state/trees_controller.dart';
import 'package:dhara/ui/widgets/climate_cards.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_location_backend.dart';

class _Trees extends TreesController {
  _Trees(this._trees);
  final List<Tree> _trees;

  @override
  Future<List<Tree>> build() async => _trees;
}

http.Response airOk({int aqi = 57, Object? co2 = 459}) => http.Response(
      jsonEncode({
        'current': {
          'time': '2026-10-17T22:30',
          'us_aqi': aqi,
          'pm2_5': 18.2,
          'pm10': 18.3,
          'carbon_dioxide': co2,
        },
      }),
      200,
    );

Future<void> show(
  WidgetTester tester,
  Widget card, {
  required List<Override> overrides,
}) async {
  tester.view.physicalSize = const Size(1000, 2600);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(home: Scaffold(body: SingleChildScrollView(child: card))),
    ),
  );
  await tester.pump(const Duration(milliseconds: 50));
}

Future<void> finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 5));
}

void main() {
  group('AirQualityCard', () {
    late FakeLocationBackend phone;
    late int calls;
    late Future<http.Response> Function() answer;

    List<Override> setup() => [
          locationServiceProvider.overrideWithValue(LocationService(backend: phone)),
          airQualityServiceProvider.overrideWithValue(
            AirQualityService(client: MockClient((_) async {
              calls++;
              return answer();
            })),
          ),
        ];

    setUp(() {
      phone = FakeLocationBackend()..permission = LocationPermission.whileInUse;
      phone.cached = pos(lat: 12.97, lng: 77.59);
      calls = 0;
      answer = () async => airOk();
    });

    testWidgets('shows the reading with its band, CO2 and attribution', (tester) async {
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Air around you'), findsOneWidget);
      expect(find.text('57'), findsOneWidget);
      expect(find.text('Moderate'), findsOneWidget);
      expect(find.text('US AQI'), findsOneWidget);
      expect(find.textContaining('459'), findsOneWidget);
      expect(find.textContaining('ppm'), findsOneWidget);
      expect(find.textContaining('Open-Meteo.com'), findsOneWidget);
      expect(find.textContaining('regional model estimate'), findsOneWidget);
      expect(find.textContaining('22:30'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('a reading without CO2 omits the CO2 chip and its caveat', (tester) async {
      answer = () async => airOk(co2: null);
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('57'), findsOneWidget);
      expect(find.textContaining('ppm'), findsNothing);
      expect(find.textContaining('regional model estimate'), findsNothing);
      await finish(tester);
    });

    testWidgets('colours and words follow the AQI', (tester) async {
      answer = () async => airOk(aqi: 258);
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Very unhealthy'), findsOneWidget);
      expect(bandColor(AirBand.forUsAqi(258)), isNot(bandColor(AirBand.good)));
      await finish(tester);
    });

    // Opening the dashboard must never throw a permission dialog at someone.
    testWidgets('without permission it offers a button and asks for nothing', (tester) async {
      phone.permission = LocationPermission.denied;
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Allow location'), findsOneWidget);
      expect(phone.requestCalls, 0);
      expect(calls, 0);
      await finish(tester);
    });

    testWidgets('tapping Allow location asks once, then loads the air', (tester) async {
      phone.permission = LocationPermission.denied;
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));

      await tester.tap(find.text('Allow location'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 400));

      expect(phone.requestCalls, 1);
      expect(find.text('57'), findsOneWidget);
      expect(find.text('Allow location'), findsNothing);
      await finish(tester);
    });

    testWidgets('a refused request says so and leaves the button in place', (tester) async {
      phone.permission = LocationPermission.denied;
      phone.answer = LocationPermission.denied;
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));

      await tester.tap(find.text('Allow location'));
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Allow location'), findsOneWidget);
      expect(find.textContaining('needs your location'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('a service failure shows a message and Retry, not a spinner', (tester) async {
      answer = () async => http.Response('down', 500);
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.textContaining('had a problem'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      await finish(tester);
    });

    testWidgets('Retry loads it once the service is back', (tester) async {
      var healthy = false;
      answer = () async => healthy ? airOk() : http.Response('down', 500);
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Retry'), findsOneWidget);

      healthy = true;
      await tester.tap(find.text('Retry'));
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('57'), findsOneWidget);
      expect(find.text('Retry'), findsNothing);
      await finish(tester);
    });

    // The reported symptom, for this card: it must not sit on loading when the
    // phone is offline. Riverpod's default would retry for about forty seconds.
    testWidgets('offline settles on an error straight away, without retry loops', (tester) async {
      answer = () async => throw http.ClientException('offline');
      await show(tester, const AirQualityCard(), overrides: setup());
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Retry'), findsOneWidget);
      expect(calls, 1);

      await tester.pump(const Duration(seconds: 30));
      expect(calls, 1, reason: 'a failed request must not be retried in the background');
      await finish(tester);
    });

    testWidgets('only a rounded location is sent to the service', (tester) async {
      Uri? seen;
      phone.cached = pos(lat: 12.97163482, lng: 77.59461177);
      final overrides = [
        locationServiceProvider.overrideWithValue(LocationService(backend: phone)),
        airQualityServiceProvider.overrideWithValue(
          AirQualityService(client: MockClient((r) async {
            seen = r.url;
            return airOk();
          })),
        ),
      ];
      await show(tester, const AirQualityCard(), overrides: overrides);
      await tester.pump(const Duration(milliseconds: 300));

      expect(seen?.queryParameters['latitude'], '13.0');
      expect(seen?.queryParameters['longitude'], '77.6');
      await finish(tester);
    });
  });

  group('AverageTreeCard', () {
    const seeded = [
      Species(code: 'neem', name: 'Neem', co2PerYearGrams: 21000),
      Species(code: 'bamboo', name: 'Bamboo', co2PerYearGrams: 30000),
      Species(code: 'other', name: 'Other', co2PerYearGrams: 15000),
    ];

    Tree tree(String species, [TreeStatus s = TreeStatus.alive]) => Tree(
          id: 't$species${s.name}',
          ownerId: 'u',
          speciesCode: species,
          speciesName: species,
          lat: 0,
          lng: 0,
          plantedAt: DateTime(2026, 1, 1),
          status: s,
        );

    List<Override> data(List<Species> species, List<Tree> trees) => [
          speciesProvider.overrideWith((ref) async => species),
          treesControllerProvider.overrideWith(() => _Trees(trees)),
        ];

    testWidgets('shows the average, per-day figure and the member total', (tester) async {
      await show(tester, const AverageTreeCard(),
          overrides: data(seeded, [tree('neem'), tree('bamboo')]));
      await tester.pump(const Duration(milliseconds: 300));

      // (21 + 30) / 2 = 25.5 -> "26 kg"; "other" is left out of the average.
      expect(find.textContaining('26 kg of CO\u2082 a year'), findsOneWidget);
      expect(find.textContaining('70 g every day'), findsOneWidget);
      expect(find.textContaining('2 living trees'), findsOneWidget);
      expect(find.textContaining('51 kg a year'), findsOneWidget);
      expect(find.textContaining('Young trees take in less'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('singular wording for one tree', (tester) async {
      await show(tester, const AverageTreeCard(), overrides: data(seeded, [tree('neem')]));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.textContaining('Your living tree will take in about 21 kg'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('a new member is invited to plant, not shown a zero', (tester) async {
      await show(tester, const AverageTreeCard(), overrides: data(seeded, const []));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.textContaining('Plant a tree and your own count starts here'), findsOneWidget);
      expect(find.textContaining('0 kg'), findsNothing);
      await finish(tester);
    });

    testWidgets('trees still in review are not counted', (tester) async {
      await show(tester, const AverageTreeCard(),
          overrides: data(seeded, [tree('neem', TreeStatus.pendingReview)]));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.textContaining('Plant a tree and your own count starts here'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('is hidden entirely until the species table has loaded', (tester) async {
      await show(tester, const AverageTreeCard(), overrides: data(const [], const []));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('What a tree can do'), findsNothing);
      await finish(tester);
    });
  });
}
