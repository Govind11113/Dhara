import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// US EPA Air Quality Index categories.
enum AirBand {
  good('Good', 'Air quality is good. A fine day to be outside.'),
  moderate(
    'Moderate',
    'Acceptable for most people. Unusually sensitive people may want to take '
        'it easier outdoors.',
  ),
  sensitive(
    'Unhealthy for sensitive groups',
    'Children, older adults and people with asthma or heart conditions should '
        'cut back on long time outdoors.',
  ),
  unhealthy(
    'Unhealthy',
    'Everyone may start to feel effects. Keep outdoor effort short.',
  ),
  veryUnhealthy(
    'Very unhealthy',
    'Avoid outdoor exertion. Planting is best left for a clearer day.',
  ),
  hazardous(
    'Hazardous',
    'Stay indoors if you can. This is an emergency-level reading.',
  );

  const AirBand(this.label, this.advice);

  final String label;
  final String advice;

  /// The EPA's published breakpoints: 0-50, 51-100, 101-150, 151-200, 201-300,
  /// and 301 upward.
  static AirBand forUsAqi(int aqi) {
    if (aqi <= 50) return AirBand.good;
    if (aqi <= 100) return AirBand.moderate;
    if (aqi <= 150) return AirBand.sensitive;
    if (aqi <= 200) return AirBand.unhealthy;
    if (aqi <= 300) return AirBand.veryUnhealthy;
    return AirBand.hazardous;
  }
}

/// One air quality reading for a place.
///
/// Every field is optional because the upstream model can leave any of them out
/// for a given location, and a missing figure must read as "no data" rather
/// than as a zero.
class AirQuality {
  const AirQuality({
    this.usAqi,
    this.pm25,
    this.pm10,
    this.ozone,
    this.no2,
    this.co2Ppm,
    this.localTime,
  });

  /// US AQI, 0-500.
  final int? usAqi;

  /// Micrograms per cubic metre.
  final double? pm25;
  final double? pm10;
  final double? ozone;
  final double? no2;

  /// Carbon dioxide in parts per million. A regional model value (about 11 km
  /// or coarser), not a sensor reading, so it moves little from place to place.
  final double? co2Ppm;

  /// "HH:mm" in the place's own time zone.
  final String? localTime;

  AirBand? get band => usAqi == null ? null : AirBand.forUsAqi(usAqi!);

  bool get hasData => usAqi != null || pm25 != null || co2Ppm != null;

  /// Reads Open-Meteo's `current` block.
  ///
  /// Throws [FormatException] if the shape is not recognisable at all. Within a
  /// recognisable response, anything missing, mistyped or physically absurd
  /// becomes null instead of an error, so one bad figure does not hide the rest.
  factory AirQuality.fromOpenMeteo(Map<String, dynamic> json) {
    final current = json['current'];
    if (current is! Map) {
      throw const FormatException('Air data response had no "current" block.');
    }

    double? number(String key, {required double min, required double max}) {
      final v = current[key];
      if (v is! num || !v.isFinite) return null;
      final d = v.toDouble();
      return d >= min && d <= max ? d : null;
    }

    final aqi = number('us_aqi', min: 0, max: 500);
    final time = current['time'];

    return AirQuality(
      usAqi: aqi?.round(),
      pm25: number('pm2_5', min: 0, max: 2000),
      pm10: number('pm10', min: 0, max: 5000),
      ozone: number('ozone', min: 0, max: 2000),
      no2: number('nitrogen_dioxide', min: 0, max: 5000),
      // Ambient CO2 anywhere on Earth is a few hundred ppm. A value outside this
      // window is a model fault, and showing it would be worse than showing
      // nothing.
      co2Ppm: number('carbon_dioxide', min: 250, max: 1500),
      localTime: time is String
          ? RegExp(r'T(\d{2}:\d{2})').firstMatch(time)?.group(1)
          : null,
    );
  }
}

class AirQualityException implements Exception {
  const AirQualityException(this.message);

  final String message;

  @override
  String toString() => message;
}

class _Cached {
  const _Cached(this.at, this.value);

  final DateTime at;
  final AirQuality value;
}

/// Fetches air quality from Open-Meteo (https://open-meteo.com).
///
/// No API key. The free tier is licensed for non-commercial use and requires
/// attribution (CC BY 4.0); an app that pays out real rewards should move to
/// their commercial plan, which is a change of host and a key here and nothing
/// else.
///
/// Privacy: coordinates are rounded to 0.1 degree (about 11 km) before they
/// leave the device. That is the resolution of the underlying model anyway, so
/// nothing is lost, and the service never learns where in a district someone is
/// standing. It also means nearby calls share one cache entry.
class AirQualityService {
  AirQualityService({
    http.Client? client,
    DateTime Function()? now,
    this.ttl = const Duration(minutes: 15),
    this.timeout = const Duration(seconds: 8),
    this.host = 'air-quality-api.open-meteo.com',
  })  : _client = client ?? http.Client(),
        _now = now ?? DateTime.now;

  final http.Client _client;
  final DateTime Function() _now;
  final Duration ttl;
  final Duration timeout;
  final String host;

  final _cache = <String, _Cached>{};
  final _inFlight = <String, Future<AirQuality>>{};

  static const _fields = [
    'us_aqi',
    'pm2_5',
    'pm10',
    'ozone',
    'nitrogen_dioxide',
    'carbon_dioxide',
  ];

  /// Rounds to the grid the model works on.
  static double snap(double degrees) => (degrees * 10).round() / 10;

  static String cacheKey(double lat, double lng) => '${snap(lat)},${snap(lng)}';

  Future<AirQuality> fetch(double lat, double lng) {
    if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180) {
      return Future.error(
        const AirQualityException('That location is not valid.'),
      );
    }

    final key = cacheKey(lat, lng);
    final hit = _cache[key];
    if (hit != null && _now().difference(hit.at) < ttl) {
      return Future.value(hit.value);
    }

    // Several widgets asking at once share one request.
    //
    // The cleanup is a block, not `=> _inFlight.remove(key)`: `whenComplete`
    // waits for any Future its callback returns, and `remove` hands back this
    // very request, so the arrow form made it wait on itself and never finish.
    return _inFlight[key] ??= _load(snap(lat), snap(lng), key).whenComplete(() {
      _inFlight.remove(key);
    });
  }

  Future<AirQuality> _load(double lat, double lng, String key) async {
    final uri = Uri.https(host, '/v1/air-quality', {
      'latitude': '$lat',
      'longitude': '$lng',
      'current': _fields.join(','),
      'timezone': 'auto',
    });

    final http.Response res;
    try {
      res = await _client.get(uri).timeout(timeout);
    } on TimeoutException {
      throw const AirQualityException('The air quality service took too long.');
    } catch (_) {
      throw const AirQualityException(
        'Could not reach the air quality service. Check your connection.',
      );
    }

    if (res.statusCode != 200) {
      throw AirQualityException(
        res.statusCode == 429
            ? 'The air quality service is busy. Try again in a moment.'
            : 'The air quality service had a problem (${res.statusCode}).',
      );
    }

    final AirQuality reading;
    try {
      final body = jsonDecode(utf8.decode(res.bodyBytes, allowMalformed: true));
      if (body is! Map<String, dynamic>) throw const FormatException('Not an object.');
      if (body['error'] == true) {
        throw AirQualityException(
          'No air data for this place (${body['reason'] ?? 'unknown reason'}).',
        );
      }
      reading = AirQuality.fromOpenMeteo(body);
    } on AirQualityException {
      rethrow;
    } catch (_) {
      throw const AirQualityException('The air quality data was unreadable.');
    }

    if (!reading.hasData) {
      throw const AirQualityException('There is no air data for this place yet.');
    }

    // Only successes are remembered, so a failure is retried on the next ask
    // instead of being served back for a quarter of an hour.
    _cache[key] = _Cached(_now(), reading);
    return reading;
  }

  void close() => _client.close();
}
