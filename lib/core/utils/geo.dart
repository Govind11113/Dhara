import 'dart:math' as math;

/// Geospatial helpers for proof-of-presence checks.
class Geo {
  const Geo._();

  static const earthRadiusM = 6371000.0;

  /// Great-circle distance in metres. Accurate enough at the 30 m scale we
  /// care about, and far cheaper than Vincenty.
  static double distanceM(double lat1, double lng1, double lat2, double lng2) {
    final dLat = _rad(lat2 - lat1);
    final dLng = _rad(lng2 - lng1);
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_rad(lat1)) *
            math.cos(_rad(lat2)) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    return earthRadiusM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  static double _rad(double deg) => deg * math.pi / 180.0;

  static const _base32 = '0123456789bcdefghjkmnpqrstuvwxyz';

  /// Geohash lets us prefix-query nearby trees without PostGIS.
  /// Precision 8 is roughly a 38 m x 19 m cell, which suits a 30 m radius.
  static String encode(double lat, double lng, {int precision = 9}) {
    var latMin = -90.0, latMax = 90.0;
    var lngMin = -180.0, lngMax = 180.0;
    final out = StringBuffer();
    var isLng = true;
    var bit = 0;
    var ch = 0;

    while (out.length < precision) {
      if (isLng) {
        final mid = (lngMin + lngMax) / 2;
        if (lng >= mid) {
          ch = (ch << 1) | 1;
          lngMin = mid;
        } else {
          ch <<= 1;
          lngMax = mid;
        }
      } else {
        final mid = (latMin + latMax) / 2;
        if (lat >= mid) {
          ch = (ch << 1) | 1;
          latMin = mid;
        } else {
          ch <<= 1;
          latMax = mid;
        }
      }
      isLng = !isLng;
      if (++bit == 5) {
        out.write(_base32[ch]);
        bit = 0;
        ch = 0;
      }
    }
    return out.toString();
  }

  /// The cell itself plus its eight neighbours, so a tree sitting just across
  /// a cell boundary is still found.
  static List<String> neighbourPrefixes(
    double lat,
    double lng, {
    int precision = 6,
  }) {
    final seen = <String>{};
    const step = 0.0009; // ~100 m, comfortably wider than our radius
    for (final dLat in [-step, 0.0, step]) {
      for (final dLng in [-step, 0.0, step]) {
        seen.add(encode(lat + dLat, lng + dLng, precision: precision));
      }
    }
    return seen.toList();
  }

  static String prettyDistance(double metres) {
    if (metres < 1000) return '${metres.round()} m';
    return '${(metres / 1000).toStringAsFixed(1)} km';
  }
}
