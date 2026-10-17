import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dhara/core/services/weather.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A real response from Open-Meteo for Bengaluru, 15-21 Oct 2026.
Map<String, dynamic> realForecast() =>
    jsonDecode(File('test/fixtures/forecast.json').readAsStringSync()) as Map<String, dynamic>;

/// 22:30 IST on 18 Oct is 17:00 UTC.
final inBengaluru = DateTime.utc(2026, 10, 18, 17, 0);

/// Builds a 7-day window (3 back, today, 3 ahead) with today at index 3.
Forecast window({
  List<double?> rain = const [0, 0, 0, 0, 0, 0, 0],
  List<double?> temp = const [30, 30, 30, 30, 30, 30, 30],
}) =>
    Forecast(
      todayIndex: 3,
      days: [
        for (var i = 0; i < 7; i++)
          DayWeather(date: '2026-10-${15 + i}', rainMm: rain[i], maxTempC: temp[i]),
      ],
    );

void main() {
  group('Forecast.fromOpenMeteo', () {
    test('reads the real response and finds today at the place', () {
      final f = Forecast.fromOpenMeteo(realForecast(), inBengaluru);
      expect(f.days, hasLength(7));
      expect(f.todayIndex, 3);
      expect(f.today.date, '2026-10-18');
      expect(f.today.rainMm, 7.1);
      expect(f.today.maxTempC, 27.3);
    });

    // 22:30 in Bengaluru is still the 18th there, even though a phone set to
    // Pacific time thinks it is the afternoon of the 18th too - but a phone in
    // Tokyo would already be on the 19th. The place decides, not the phone.
    test('today is the date at the place, not on the phone', () {
      final json = realForecast();
      final late = DateTime.utc(2026, 10, 18, 19, 0); // 00:30 on the 19th in India
      expect(Forecast.fromOpenMeteo(json, late).today.date, '2026-10-19');
      final earlier = DateTime.utc(2026, 10, 18, 18, 29); // 23:59 on the 18th
      expect(Forecast.fromOpenMeteo(json, earlier).today.date, '2026-10-18');
    });

    test('rain over a range, relative to today', () {
      final f = Forecast.fromOpenMeteo(realForecast(), inBengaluru);
      expect(f.rainBetween(-3, -1), closeTo(7.2 + 17.1 + 14.5, 1e-9));
      expect(f.rainBetween(0, 1), closeTo(7.1 + 6.7, 1e-9));
      expect(f.maxTempBetween(0, 2), 28.1 > 27.8 ? 28.1 : 27.8);
    });

    test('a window that does not include today is rejected', () {
      final tooLate = DateTime.utc(2026, 10, 30);
      expect(() => Forecast.fromOpenMeteo(realForecast(), tooLate), throwsFormatException);
    });

    test('a response without a daily block is rejected', () {
      expect(() => Forecast.fromOpenMeteo({}, inBengaluru), throwsFormatException);
      expect(() => Forecast.fromOpenMeteo({'daily': {}}, inBengaluru), throwsFormatException);
    });

    test('missing and absurd readings become unknown, not zero', () {
      final json = realForecast();
      (json['daily'] as Map)['precipitation_sum'] = [1, null, 'wet', 9999, 2, 3, 4];
      (json['daily'] as Map)['temperature_2m_max'] = [30, 99, null, 'hot', 28, 28, 28];
      final f = Forecast.fromOpenMeteo(json, inBengaluru);
      expect(f.days[1].rainMm, isNull);
      expect(f.days[2].rainMm, isNull);
      expect(f.days[3].rainMm, isNull); // 9999 mm is not weather
      expect(f.days[1].maxTempC, isNull); // 99 C is not weather
    });

    test('no reading in a range is null rather than zero', () {
      final f = window(rain: [null, null, null, 0, 0, 0, 0]);
      expect(f.rainBetween(-3, -1), isNull);
      expect(f.rainBetween(0, 1), 0);
    });

    test('a range that runs off the ends is clipped', () {
      final f = window(rain: [1, 1, 1, 1, 1, 1, 1]);
      expect(f.rainBetween(-10, 10), 7);
      expect(f.rainBetween(5, 9), isNull);
    });
  });

  group('careAdvice', () {
    CareAdvice? advise({
      double recent = 0,
      double today = 0,
      double tomorrow = 0,
      double high = 30,
    }) =>
        careAdvice(window(
          rain: [recent, 0, 0, today, tomorrow, 0, 0],
          temp: [30, 30, 30, high, high, high, high],
        ));

    group('rain on the way', () {
      test('at 5 mm over today and tomorrow, watering is skipped', () {
        expect(advise(today: 3, tomorrow: 2)?.kind, CareKind.rainComing);
      });

      test('just under 5 mm is not enough', () {
        expect(advise(today: 3, tomorrow: 1.9)?.kind, isNot(CareKind.rainComing));
      });

      test('it wins over a dry past', () {
        expect(advise(recent: 0, today: 6)?.kind, CareKind.rainComing);
      });

      test('the amount is stated', () {
        expect(advise(today: 3, tomorrow: 2)?.detail, contains('5.0 mm'));
        expect(advise(today: 12, tomorrow: 8)?.detail, contains('20 mm'));
      });
    });

    group('recent rain', () {
      test('10 mm over the last three days means the soil is still moist', () {
        expect(advise(recent: 10)?.kind, CareKind.soaked);
      });

      test('just under 10 mm does not', () {
        expect(advise(recent: 9.9)?.kind, isNot(CareKind.soaked));
      });

      test('forecast rain outranks past rain', () {
        expect(advise(recent: 30, today: 6)?.kind, CareKind.rainComing);
      });
    });

    group('dry spells', () {
      test('almost no rain either side is dry', () {
        expect(advise()?.kind, CareKind.dry);
        expect(advise(recent: 1.9, today: 1.9)?.kind, CareKind.dry);
      });

      test('2 mm in either window ends the dry spell', () {
        expect(advise(recent: 2)?.kind, CareKind.mixed);
        expect(advise(today: 2)?.kind, CareKind.mixed);
      });

      test('35 degrees makes it hot and dry', () {
        expect(advise(high: 35)?.kind, CareKind.hotAndDry);
        expect(advise(high: 34.9)?.kind, CareKind.dry);
      });

      test('the heat is reported', () {
        expect(advise(high: 38)?.detail, contains('38'));
      });

      test('heat alone, with rain about, is not "hot and dry"', () {
        expect(advise(recent: 5, high: 40)?.kind, CareKind.mixed);
      });
    });

    group('not enough to go on', () {
      test('no rain readings at all gives no advice', () {
        expect(careAdvice(window(rain: List.filled(7, null))), isNull);
      });

      // "Dry" is a claim about both the past and the future, so it needs both.
      test('an unknown past is never declared dry', () {
        final a = careAdvice(window(rain: [null, null, null, 0, 0, 0, 0]));
        expect(a?.kind, CareKind.mixed);
        expect(a?.kind, isNot(CareKind.dry));
      });

      test('an unknown future is never declared dry', () {
        final a = careAdvice(window(rain: [0, 0, 0, null, null, null, null]));
        expect(a?.kind, CareKind.mixed);
      });

      test('but known heavy rain is still reported when the other side is unknown', () {
        expect(careAdvice(window(rain: [5, 5, 5, null, null, 0, 0]))?.kind, CareKind.soaked);
        expect(careAdvice(window(rain: [null, null, null, 3, 3, 0, 0]))?.kind, CareKind.rainComing);
      });
    });

    test('every outcome has a headline and a detail, and a colour-free meaning', () {
      final all = <CareAdvice?>[
        advise(today: 9),
        advise(recent: 12),
        advise(high: 40),
        advise(),
        advise(recent: 3),
      ];
      expect(all.map((a) => a!.kind).toSet(), CareKind.values.toSet());
      for (final a in all) {
        expect(a!.headline, isNotEmpty);
        expect(a.detail.length, greaterThan(20));
      }
    });

    test('works on the real forecast: rain forecast for today and tomorrow', () {
      final f = Forecast.fromOpenMeteo(realForecast(), inBengaluru);
      final a = careAdvice(f)!;
      expect(a.kind, CareKind.rainComing); // 7.1 + 6.7 mm
      expect(a.recentRainMm, closeTo(38.8, 1e-9));
    });
  });

  group('WeatherService', () {
    late List<Uri> requests;
    late DateTime clock;

    WeatherService build(Future<http.Response> Function() answer, {Duration? timeout}) {
      requests = [];
      clock = inBengaluru;
      return WeatherService(
        client: MockClient((r) async {
          requests.add(r.url);
          return answer();
        }),
        now: () => clock,
        timeout: timeout ?? const Duration(seconds: 8),
      );
    }

    // Real responses are UTF-8 (the units contain "°C"), so the mock must be too.
    http.Response good() => http.Response.bytes(
          utf8.encode(jsonEncode(realForecast())),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );

    test('asks for rain and temperature, three days back and four ahead', () async {
      final s = build(() async => good());
      await s.fetch(12.97, 77.59);
      final q = requests.single.queryParameters;
      expect(requests.single.host, 'api.open-meteo.com');
      expect(q['daily'], 'precipitation_sum,temperature_2m_max');
      expect(q['past_days'], '3');
      expect(q['forecast_days'], '4');
      expect(q['timezone'], 'auto');
    });

    test('a tree\'s exact spot is rounded before it is sent', () async {
      final s = build(() async => good());
      await s.fetch(12.97163482, 77.59461177);
      expect(requests.single.queryParameters['latitude'], '13.0');
      expect(requests.single.queryParameters['longitude'], '77.6');
      expect(requests.single.toString(), isNot(contains('12.9716')));
    });

    test('a second ask inside the window makes no request', () async {
      final s = build(() async => good());
      await s.fetch(12.97, 77.59);
      clock = clock.add(const Duration(minutes: 29));
      await s.fetch(12.99, 77.61);
      expect(requests, hasLength(1));
    });

    test('after 30 minutes it asks again', () async {
      final s = build(() async => good());
      await s.fetch(12.97, 77.59);
      clock = clock.add(const Duration(minutes: 30));
      await s.fetch(12.97, 77.59);
      expect(requests, hasLength(2));
    });

    // "Today" moves while the cached answer sits still. Crossing midnight at the
    // place must change which day is today, without a second request, because the
    // cached window still holds the new day.
    test('past midnight at the place the same cached answer reports the new day', () async {
      final s = build(() async => good());
      clock = DateTime.utc(2026, 10, 18, 18, 20); // 23:50 on the 18th in India
      final before = await s.fetch(12.97, 77.59);
      expect(before.today.date, '2026-10-18');

      clock = DateTime.utc(2026, 10, 18, 18, 40); // 00:10 on the 19th, 20 minutes on
      final after = await s.fetch(12.97, 77.59);
      expect(after.today.date, '2026-10-19');
      expect(requests, hasLength(1));
    });

    test('when the cached window no longer holds today it fetches a new one', () async {
      final s = build(() async => good());
      await s.fetch(12.97, 77.59);
      // Still inside the TTL, but the fixture window ends on the 21st.
      clock = DateTime.utc(2026, 10, 21, 19, 0); // the 22nd in India
      // The refetch returns the same stale fixture, so it fails to parse today.
      await expectLater(s.fetch(12.97, 77.59), throwsA(isA<WeatherException>()));
      expect(requests, hasLength(2));
    });

    test('simultaneous asks share one request', () async {
      final gate = Completer<void>();
      final s = build(() async {
        await gate.future;
        return good();
      });
      final all = Future.wait([s.fetch(12.97, 77.59), s.fetch(12.98, 77.6)]);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      gate.complete();
      await all;
      expect(requests, hasLength(1));
    });

    test('a failure is not cached', () async {
      var n = 0;
      final s = build(() async => ++n == 1 ? http.Response('x', 500) : good());
      await expectLater(s.fetch(12.97, 77.59), throwsA(isA<WeatherException>()));
      expect((await s.fetch(12.97, 77.59)).days, hasLength(7));
    });

    group('failures read as sentences', () {
      Future<void> expectMessage(WeatherService s, Pattern text) => expectLater(
            s.fetch(12, 77),
            throwsA(isA<WeatherException>().having((e) => e.message, 'message', contains(text))),
          );

      test('server error', () => expectMessage(build(() async => http.Response('', 500)), '500'));
      test('busy', () => expectMessage(build(() async => http.Response('', 429)), 'busy'));
      test('offline', () => expectMessage(build(() async => throw const SocketException('x')), 'connection'));
      test('garbage', () => expectMessage(build(() async => http.Response('<html>', 200)), 'unreadable'));
      test('timeout', () {
        final never = Completer<http.Response>();
        return expectMessage(build(() => never.future, timeout: const Duration(milliseconds: 50)), 'too long');
      });
      test('API error', () => expectMessage(
            build(() async => http.Response(jsonEncode({'error': true, 'reason': 'Bad latitude'}), 200)),
            'Bad latitude',
          ));
    });

    test('invalid coordinates never reach the network', () async {
      final s = build(() async => good());
      for (final c in [(double.nan, 0.0), (95.0, 0.0), (0.0, 200.0)]) {
        await expectLater(s.fetch(c.$1, c.$2), throwsA(isA<WeatherException>()));
      }
      expect(requests, isEmpty);
    });
  });

  group('live Open-Meteo forecast', () {
    test('returns a usable forecast for a real place', () async {
      final s = WeatherService();
      try {
        final f = await s.fetch(12.9716, 77.5946);
        final a = careAdvice(f);
        // ignore: avoid_print
        print('today ${f.today.date}: rain ${f.today.rainMm} mm, high ${f.today.maxTempC} C -> ${a?.headline}');
        expect(f.days.length, inInclusiveRange(6, 8));
        expect(f.today.maxTempC, isNotNull);
      } finally {
        s.close();
      }
    }, skip: Platform.environment['LIVE'] == '1' ? false : 'set LIVE=1 to call the real API');
  });

  test('a stray bad byte in text we never show does not make the forecast unreadable', () async {
    final good = utf8.encode(jsonEncode(realForecast()));
    final bytes = [...good]..replaceRange(good.indexOf(0xC2), good.indexOf(0xC2) + 1, [0xFF]);
    final s = WeatherService(
      client: MockClient((_) async => http.Response.bytes(bytes, 200)),
      now: () => inBengaluru,
    );
    expect((await s.fetch(12.97, 77.59)).days, hasLength(7));
  });
}
