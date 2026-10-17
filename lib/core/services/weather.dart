import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// One day of weather at a place, in that place's own calendar.
class DayWeather {
  const DayWeather({required this.date, this.rainMm, this.maxTempC});

  /// "2026-10-18", the local date at the place.
  final String date;
  final double? rainMm;
  final double? maxTempC;
}

/// Three days back, today, and the days ahead.
class Forecast {
  const Forecast({required this.days, required this.todayIndex});

  final List<DayWeather> days;
  final int todayIndex;

  DayWeather get today => days[todayIndex];

  /// Rain over days [from] to [to] inclusive, relative to today (0 is today,
  /// -1 yesterday). Null when no day in the range has a reading, so "no data"
  /// is never mistaken for "no rain".
  double? rainBetween(int from, int to) {
    double? total;
    for (var d = from; d <= to; d++) {
      final i = todayIndex + d;
      if (i < 0 || i >= days.length) continue;
      final mm = days[i].rainMm;
      if (mm != null) total = (total ?? 0) + mm;
    }
    return total;
  }

  /// Hottest daily maximum over the range, or null with no readings.
  double? maxTempBetween(int from, int to) {
    double? hottest;
    for (var d = from; d <= to; d++) {
      final i = todayIndex + d;
      if (i < 0 || i >= days.length) continue;
      final t = days[i].maxTempC;
      if (t != null && (hottest == null || t > hottest)) hottest = t;
    }
    return hottest;
  }

  /// Reads Open-Meteo's `daily` block.
  ///
  /// [nowUtc] is used to find which entry is today *at the place*, using the
  /// UTC offset the API returns, so a phone in another time zone still reads the
  /// right day. Throws [FormatException] if the response has no daily block or
  /// does not include today.
  factory Forecast.fromOpenMeteo(Map<String, dynamic> json, DateTime nowUtc) {
    final daily = json['daily'];
    if (daily is! Map || daily['time'] is! List) {
      throw const FormatException('Forecast had no daily block.');
    }
    final times = (daily['time'] as List).whereType<String>().toList();
    final rain = daily['precipitation_sum'];
    final temp = daily['temperature_2m_max'];

    double? at(Object? list, int i, double min, double max) {
      if (list is! List || i >= list.length) return null;
      final v = list[i];
      if (v is! num || !v.isFinite) return null;
      final d = v.toDouble();
      // Outside any real reading, so it is a fault in the data and not weather.
      return d >= min && d <= max ? d : null;
    }

    final days = [
      for (var i = 0; i < times.length; i++)
        DayWeather(
          date: times[i],
          rainMm: at(rain, i, 0, 1500),
          maxTempC: at(temp, i, -60, 60),
        ),
    ];

    final offset = json['utc_offset_seconds'];
    final local = nowUtc.toUtc().add(Duration(seconds: offset is num ? offset.round() : 0));
    final today = '${local.year.toString().padLeft(4, '0')}-'
        '${local.month.toString().padLeft(2, '0')}-'
        '${local.day.toString().padLeft(2, '0')}';

    final index = days.indexWhere((d) => d.date == today);
    if (index < 0) {
      throw const FormatException('Forecast did not include today.');
    }
    return Forecast(days: days, todayIndex: index);
  }
}

/// What the tree most likely needs from its owner right now.
enum CareKind { rainComing, soaked, hotAndDry, dry, mixed }

class CareAdvice {
  const CareAdvice({
    required this.kind,
    required this.headline,
    required this.detail,
    this.recentRainMm,
    this.soonRainMm,
    this.highC,
  });

  final CareKind kind;
  final String headline;
  final String detail;
  final double? recentRainMm;
  final double? soonRainMm;
  final double? highC;
}

/// Rainfall thresholds, in millimetres, and the heat threshold in degrees.
///
/// Rules of thumb for watering a *young* tree, chosen to be cautious rather
/// than clever. They are general, not species-specific, and the screen says so.
class CareThresholds {
  const CareThresholds._();

  /// Rain expected over today and tomorrow that makes watering pointless.
  static const rainComingMm = 5.0;

  /// Rain over the last three days after which the soil is likely still moist.
  static const soakedMm = 10.0;

  /// Below this, over both the last three days and the next two, it is dry.
  static const dryMm = 2.0;

  /// A day this hot dries the soil quickly.
  static const hotC = 35.0;
}

String _mm(double v) => v < 10 ? v.toStringAsFixed(1) : v.round().toString();

/// Turns a forecast into plain watering guidance, or null when the forecast has
/// too little in it to say anything honest.
CareAdvice? careAdvice(Forecast f) {
  final recent = f.rainBetween(-3, -1);
  final soon = f.rainBetween(0, 1);
  final high = f.maxTempBetween(0, 2);

  if (soon != null && soon >= CareThresholds.rainComingMm) {
    return CareAdvice(
      kind: CareKind.rainComing,
      headline: 'Rain is on the way',
      detail: 'About ${_mm(soon)} mm is forecast over today and tomorrow, so '
          'there is no need to water.',
      recentRainMm: recent,
      soonRainMm: soon,
      highC: high,
    );
  }

  if (recent != null && recent >= CareThresholds.soakedMm) {
    return CareAdvice(
      kind: CareKind.soaked,
      headline: 'The soil should still be moist',
      detail: 'About ${_mm(recent)} mm fell over the last three days. Skip '
          'watering today.',
      recentRainMm: recent,
      soonRainMm: soon,
      highC: high,
    );
  }

  // "Dry" is a claim about two windows. Say it only when both were read.
  if (recent != null &&
      soon != null &&
      recent < CareThresholds.dryMm &&
      soon < CareThresholds.dryMm) {
    final hot = high != null && high >= CareThresholds.hotC;
    return CareAdvice(
      kind: hot ? CareKind.hotAndDry : CareKind.dry,
      headline: hot ? 'Hot and dry: water today' : 'A dry spell: check the soil',
      detail: hot
          ? 'Almost no rain for days, and highs near ${high.round()}\u00B0C. '
              'Water deeply, early morning or evening.'
          : 'Almost no rain in the last three days or the next two. Push a '
              'finger in; if the top few centimetres are dry, water.',
      recentRainMm: recent,
      soonRainMm: soon,
      highC: high,
    );
  }

  if (recent != null || soon != null) {
    return CareAdvice(
      kind: CareKind.mixed,
      headline: 'Some rain around',
      detail: 'Check the soil with a finger before watering \u2014 if it is '
          'damp a few centimetres down, leave it.',
      recentRainMm: recent,
      soonRainMm: soon,
      highC: high,
    );
  }

  return null;
}

class WeatherException implements Exception {
  const WeatherException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// The raw response is what is kept, not the parsed forecast: "today" moves, so
/// the position of today in the list is worked out again on every read.
class _Cached {
  const _Cached(this.at, this.json);

  final DateTime at;
  final Map<String, dynamic> json;
}

/// Fetches the forecast from Open-Meteo (https://open-meteo.com).
///
/// Same arrangement as the air quality service: no key, free tier licensed for
/// non-commercial use with CC BY 4.0 attribution, coordinates rounded to 0.1
/// degree (about 11 km) before they leave the device so a tree's exact spot is
/// never sent, only its area.
class WeatherService {
  WeatherService({
    http.Client? client,
    DateTime Function()? now,
    this.ttl = const Duration(minutes: 30),
    this.timeout = const Duration(seconds: 8),
    this.host = 'api.open-meteo.com',
  })  : _client = client ?? http.Client(),
        _now = now ?? DateTime.now;

  final http.Client _client;
  final DateTime Function() _now;
  final Duration ttl;
  final Duration timeout;
  final String host;

  final _cache = <String, _Cached>{};
  final _inFlight = <String, Future<Forecast>>{};

  static double snap(double degrees) => (degrees * 10).round() / 10;

  static String cacheKey(double lat, double lng) => '${snap(lat)},${snap(lng)}';

  Future<Forecast> fetch(double lat, double lng) {
    if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180) {
      return Future.error(const WeatherException('That location is not valid.'));
    }

    final key = cacheKey(lat, lng);
    final hit = _cache[key];
    if (hit != null && _now().difference(hit.at) < ttl) {
      try {
        return Future.value(Forecast.fromOpenMeteo(hit.json, _now().toUtc()));
      } on FormatException {
        // The cached window no longer includes today (it is past midnight at
        // the place). Fall through and fetch a fresh one.
      }
    }

    // Block body, not an arrow: `whenComplete` waits on any Future its callback
    // returns, and Map.remove returns this very request.
    return _inFlight[key] ??= _load(snap(lat), snap(lng)).whenComplete(() {
      _inFlight.remove(key);
    });
  }

  Future<Forecast> _load(double lat, double lng) async {
    final uri = Uri.https(host, '/v1/forecast', {
      'latitude': '$lat',
      'longitude': '$lng',
      'daily': 'precipitation_sum,temperature_2m_max',
      'past_days': '3',
      'forecast_days': '4',
      'timezone': 'auto',
    });

    final http.Response res;
    try {
      res = await _client.get(uri).timeout(timeout);
    } on TimeoutException {
      throw const WeatherException('The weather service took too long.');
    } catch (_) {
      throw const WeatherException(
        'Could not reach the weather service. Check your connection.',
      );
    }

    if (res.statusCode != 200) {
      throw WeatherException(
        res.statusCode == 429
            ? 'The weather service is busy. Try again in a moment.'
            : 'The weather service had a problem (${res.statusCode}).',
      );
    }

    final Map<String, dynamic> body;
    final Forecast forecast;
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes, allowMalformed: true));
      if (decoded is! Map<String, dynamic>) throw const FormatException('Not an object.');
      if (decoded['error'] == true) {
        throw WeatherException('No forecast for this place (${decoded['reason'] ?? 'unknown reason'}).');
      }
      body = decoded;
      forecast = Forecast.fromOpenMeteo(body, _now().toUtc());
    } on WeatherException {
      rethrow;
    } catch (_) {
      throw const WeatherException('The forecast was unreadable.');
    }

    _cache[cacheKey(lat, lng)] = _Cached(_now(), body);
    return forecast;
  }

  void close() => _client.close();
}
