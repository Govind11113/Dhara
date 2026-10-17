import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dhara/core/services/air_quality.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Shaped exactly like a real Open-Meteo answer for Bengaluru.
Map<String, dynamic> payload({
  Map<String, dynamic>? current,
  bool includeCurrent = true,
}) =>
    {
      'latitude': 13.0,
      'longitude': 77.6,
      'timezone': 'Asia/Kolkata',
      'current_units': {'us_aqi': 'USAQI', 'carbon_dioxide': 'ppm'},
      if (includeCurrent)
        'current': {
          'time': '2026-10-17T22:30',
          'interval': 3600,
          'us_aqi': 57,
          'pm2_5': 18.2,
          'pm10': 18.3,
          'ozone': 16.0,
          'nitrogen_dioxide': 45.9,
          'carbon_dioxide': 459,
          ...?current,
        },
    };

http.Response ok([Map<String, dynamic>? body]) =>
    http.Response(jsonEncode(body ?? payload()), 200, headers: {'content-type': 'application/json'});

void main() {
  group('AirBand.forUsAqi', () {
    test('uses the EPA breakpoints, including both sides of each edge', () {
      const expected = {
        0: AirBand.good,
        50: AirBand.good,
        51: AirBand.moderate,
        100: AirBand.moderate,
        101: AirBand.sensitive,
        150: AirBand.sensitive,
        151: AirBand.unhealthy,
        200: AirBand.unhealthy,
        201: AirBand.veryUnhealthy,
        300: AirBand.veryUnhealthy,
        301: AirBand.hazardous,
        500: AirBand.hazardous,
      };
      expected.forEach((aqi, band) => expect(AirBand.forUsAqi(aqi), band, reason: 'AQI $aqi'));
    });

    test('every band has a label and plain advice', () {
      for (final b in AirBand.values) {
        expect(b.label, isNotEmpty);
        expect(b.advice, isNotEmpty);
      }
    });
  });

  group('AirQuality.fromOpenMeteo', () {
    test('reads a real response', () {
      final a = AirQuality.fromOpenMeteo(payload());
      expect(a.usAqi, 57);
      expect(a.pm25, 18.2);
      expect(a.co2Ppm, 459);
      expect(a.localTime, '22:30');
      expect(a.band, AirBand.moderate);
      expect(a.hasData, isTrue);
    });

    test('a missing figure is null, not zero, and does not hide the others', () {
      final a = AirQuality.fromOpenMeteo(payload(current: {'carbon_dioxide': null}));
      expect(a.co2Ppm, isNull);
      expect(a.usAqi, 57);
    });

    test('wrong types are ignored rather than crashing', () {
      final a = AirQuality.fromOpenMeteo(payload(current: {'us_aqi': 'high', 'pm2_5': [1]}));
      expect(a.usAqi, isNull);
      expect(a.pm25, isNull);
      expect(a.band, isNull);
    });

    // A model fault must not be displayed as fact.
    test('physically absurd values are dropped', () {
      final a = AirQuality.fromOpenMeteo(payload(current: {
        'carbon_dioxide': 9,
        'us_aqi': 900,
        'pm2_5': -4,
      }));
      expect(a.co2Ppm, isNull);
      expect(a.usAqi, isNull);
      expect(a.pm25, isNull);
    });

    test('CO2 accepts the realistic range only', () {
      expect(AirQuality.fromOpenMeteo(payload(current: {'carbon_dioxide': 250})).co2Ppm, 250);
      expect(AirQuality.fromOpenMeteo(payload(current: {'carbon_dioxide': 1500})).co2Ppm, 1500);
      expect(AirQuality.fromOpenMeteo(payload(current: {'carbon_dioxide': 249})).co2Ppm, isNull);
      expect(AirQuality.fromOpenMeteo(payload(current: {'carbon_dioxide': 1501})).co2Ppm, isNull);
    });

    test('a response with no current block is rejected', () {
      expect(() => AirQuality.fromOpenMeteo(payload(includeCurrent: false)), throwsFormatException);
      expect(() => AirQuality.fromOpenMeteo({'current': 'x'}), throwsFormatException);
    });

    test('a block with nothing usable has no data', () {
      final a = AirQuality.fromOpenMeteo({'current': {'time': '2026-10-17T22:30'}});
      expect(a.hasData, isFalse);
    });

    test('a malformed time becomes null', () {
      expect(AirQuality.fromOpenMeteo(payload(current: {'time': 'soon'})).localTime, isNull);
      expect(AirQuality.fromOpenMeteo(payload(current: {'time': 5})).localTime, isNull);
    });
  });

  group('AirQualityService', () {
    late List<Uri> requests;
    late DateTime clock;

    AirQualityService build(Future<http.Response> Function(http.Request) handler,
        {Duration? timeout}) {
      requests = [];
      clock = DateTime.utc(2026, 10, 17, 12);
      return AirQualityService(
        client: MockClient((r) async {
          requests.add(r.url);
          return handler(r);
        }),
        now: () => clock,
        timeout: timeout ?? const Duration(seconds: 8),
      );
    }

    test('asks for the right fields from the right place', () async {
      final s = build((_) async => ok());
      await s.fetch(12.9716, 77.5946);

      final uri = requests.single;
      expect(uri.scheme, 'https');
      expect(uri.host, 'air-quality-api.open-meteo.com');
      expect(uri.path, '/v1/air-quality');
      expect(uri.queryParameters['current'], contains('carbon_dioxide'));
      expect(uri.queryParameters['current'], contains('us_aqi'));
      expect(uri.queryParameters['timezone'], 'auto');
    });

    // The point of rounding: the service learns the district, not the street.
    test('coordinates are rounded before they leave the device', () async {
      final s = build((_) async => ok());
      await s.fetch(12.97163482, 77.59461177);
      expect(requests.single.queryParameters['latitude'], '13.0');
      expect(requests.single.queryParameters['longitude'], '77.6');
      expect(requests.single.toString(), isNot(contains('12.9716')));
      expect(requests.single.toString(), isNot(contains('77.5946')));
    });

    test('rounding handles the southern and western hemispheres', () {
      expect(AirQualityService.snap(-33.8688), -33.9);
      expect(AirQualityService.snap(151.2093), 151.2);
      expect(AirQualityService.snap(-0.04), 0.0);
    });

    test('returns the parsed reading', () async {
      final s = build((_) async => ok());
      final a = await s.fetch(12.97, 77.59);
      expect((a.usAqi, a.co2Ppm), (57, 459.0));
    });

    group('cache', () {
      test('a second ask inside 15 minutes makes no request', () async {
        final s = build((_) async => ok());
        await s.fetch(12.97, 77.59);
        clock = clock.add(const Duration(minutes: 14, seconds: 59));
        await s.fetch(12.97, 77.59);
        expect(requests, hasLength(1));
      });

      test('after 15 minutes it asks again', () async {
        final s = build((_) async => ok());
        await s.fetch(12.97, 77.59);
        clock = clock.add(const Duration(minutes: 15));
        await s.fetch(12.97, 77.59);
        expect(requests, hasLength(2));
      });

      test('two points in the same 11 km cell share an entry', () async {
        final s = build((_) async => ok());
        await s.fetch(12.97, 77.59);
        await s.fetch(13.02, 77.63);
        expect(requests, hasLength(1));
      });

      test('a different city is a different entry', () async {
        final s = build((_) async => ok());
        await s.fetch(12.97, 77.59);
        await s.fetch(19.07, 72.87);
        expect(requests, hasLength(2));
      });

      test('simultaneous asks share one request', () async {
        final gate = Completer<void>();
        final s = build((_) async {
          await gate.future;
          return ok();
        });
        final all = Future.wait([s.fetch(12.97, 77.59), s.fetch(12.98, 77.6), s.fetch(12.96, 77.58)]);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        gate.complete();
        final results = await all;
        expect(requests, hasLength(1));
        expect(results.map((r) => r.usAqi), everyElement(57));
      });

      // A blip must not be remembered for a quarter of an hour.
      test('a failure is not cached: the next ask tries again', () async {
        var n = 0;
        final s = build((_) async => ++n == 1 ? http.Response('boom', 500) : ok());
        await expectLater(s.fetch(12.97, 77.59), throwsA(isA<AirQualityException>()));
        final a = await s.fetch(12.97, 77.59);
        expect(a.usAqi, 57);
        expect(requests, hasLength(2));
      });

      test('after a failed request a later one is not stuck waiting on it', () async {
        var n = 0;
        final s = build((_) async => ++n == 1 ? http.Response('x', 503) : ok());
        await expectLater(s.fetch(1, 1), throwsA(isA<AirQualityException>()));
        await expectLater(s.fetch(1, 1), completes);
      });
    });

    group('failures become readable messages', () {
      test('server error', () async {
        final s = build((_) async => http.Response('no', 500));
        await expectLater(
          s.fetch(12, 77),
          throwsA(isA<AirQualityException>().having((e) => e.message, 'message', contains('500'))),
        );
      });

      test('rate limited', () async {
        final s = build((_) async => http.Response('slow down', 429));
        await expectLater(
          s.fetch(12, 77),
          throwsA(isA<AirQualityException>().having((e) => e.message, 'message', contains('busy'))),
        );
      });

      test('no connection', () async {
        final s = build((_) async => throw const SocketException('Failed host lookup'));
        await expectLater(
          s.fetch(12, 77),
          throwsA(isA<AirQualityException>().having((e) => e.message, 'message', contains('connection'))),
        );
      });

      test('a hung request times out instead of waiting forever', () async {
        final never = Completer<http.Response>();
        final s = build((_) => never.future, timeout: const Duration(milliseconds: 60));
        await expectLater(
          s.fetch(12, 77),
          throwsA(isA<AirQualityException>().having((e) => e.message, 'message', contains('too long'))),
        );
      });

      test('garbage in the body', () async {
        final s = build((_) async => http.Response('<html>oops</html>', 200));
        await expectLater(
          s.fetch(12, 77),
          throwsA(isA<AirQualityException>().having((e) => e.message, 'message', contains('unreadable'))),
        );
      });

      test('an API-level error is passed on with its reason', () async {
        final s = build((_) async => http.Response(
              jsonEncode({'error': true, 'reason': 'Latitude must be in range of -90 to 90'}),
              200,
            ));
        await expectLater(
          s.fetch(12, 77),
          throwsA(isA<AirQualityException>().having((e) => e.message, 'message', contains('Latitude'))),
        );
      });

      test('a response with nothing in it is reported as no data', () async {
        final s = build((_) async => ok({'current': {'time': '2026-10-17T22:30'}}));
        await expectLater(
          s.fetch(12, 77),
          throwsA(isA<AirQualityException>().having((e) => e.message, 'message', contains('no air data'))),
        );
      });

      test('invalid coordinates never reach the network', () async {
        final s = build((_) async => ok());
        for (final c in [(double.nan, 0.0), (91.0, 0.0), (0.0, 181.0), (double.infinity, 0.0)]) {
          await expectLater(s.fetch(c.$1, c.$2), throwsA(isA<AirQualityException>()));
        }
        expect(requests, isEmpty);
      });
    });
  });

  // Opt-in: hits the real service. `LIVE=1 flutter test test/air_quality_test.dart`
  group('live Open-Meteo', () {
    final enabled = Platform.environment['LIVE'] == '1';

    test('returns plausible CO2 and AQI for two real cities', () async {
      final s = AirQualityService();
      try {
        for (final (name, lat, lng) in [
          ('Bengaluru', 12.9716, 77.5946),
          ('Mumbai', 19.0760, 72.8777),
        ]) {
          final a = await s.fetch(lat, lng);
          // ignore: avoid_print
          print('$name: AQI ${a.usAqi} (${a.band?.label}), PM2.5 ${a.pm25}, CO2 ${a.co2Ppm} ppm at ${a.localTime}');
          expect(a.usAqi, inInclusiveRange(0, 500), reason: name);
          expect(a.co2Ppm, inInclusiveRange(380, 600), reason: name);
          expect(a.pm25, isNotNull, reason: name);
        }
      } finally {
        s.close();
      }
    }, skip: enabled ? false : 'set LIVE=1 to call the real API');
  });
}
