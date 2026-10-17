import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:intl/intl.dart';

/// A way of getting about that the calculator understands.
///
/// [key] is what the server expects and must match `TRAVEL_MODES` in
/// functions/api/src/lib/footprint.js; a test pins the list so the two cannot
/// drift apart unnoticed.
class TravelMode {
  const TravelMode(this.key, this.label, this.unit);

  final String key;
  final String label;
  final String unit;
}

const kTravelModes = <TravelMode>[
  TravelMode('car_petrol', 'Car (petrol)', 'km driven'),
  TravelMode('car_diesel', 'Car (diesel)', 'km driven'),
  TravelMode('motorbike', 'Motorbike or scooter', 'km ridden'),
  TravelMode('taxi', 'Taxi or cab', 'km travelled'),
  TravelMode('bus', 'Bus', 'km travelled'),
  TravelMode('rail', 'Train or metro', 'km travelled'),
  TravelMode('flight_domestic', 'Flight within India', 'km flown'),
  TravelMode('flight_international', 'International flight', 'km flown'),
];

/// What the person typed. Everything is per month.
class FootprintInputs extends Equatable {
  const FootprintInputs({
    this.householdSize = 1,
    this.carOccupants = 1,
    this.electricityKwh = 0,
    this.lpgCylinders = 0,
    this.travel = const {},
  });

  final int householdSize;
  final int carOccupants;
  final double electricityKwh;
  final double lpgCylinders;

  /// Kilometres by [TravelMode.key]. Absent means none.
  final Map<String, double> travel;

  bool get hasActivity =>
      electricityKwh > 0 ||
      lpgCylinders > 0 ||
      travel.values.any((km) => km > 0);

  Map<String, dynamic> toJson() => {
        'householdSize': householdSize,
        'carOccupants': carOccupants,
        'electricityKwh': electricityKwh,
        'lpgCylinders': lpgCylinders,
        'travel': {
          for (final e in travel.entries)
            if (e.value > 0) e.key: e.value,
        },
      };

  factory FootprintInputs.fromJson(Map<String, dynamic> m) {
    final raw = m['travel'];
    return FootprintInputs(
      householdSize: _int(m['householdSize'], 1).clamp(1, 20),
      carOccupants: _int(m['carOccupants'], 1).clamp(1, 8),
      electricityKwh: _dbl(m['electricityKwh']),
      lpgCylinders: _dbl(m['lpgCylinders']),
      travel: raw is Map
          ? {
              for (final e in raw.entries)
                if (e.key is String) e.key as String: _dbl(e.value),
            }
          : const {},
    );
  }

  @override
  List<Object?> get props =>
      [householdSize, carOccupants, electricityKwh, lpgCylinders, travel];
}

class FootprintLine {
  const FootprintLine({
    required this.key,
    required this.group,
    required this.label,
    required this.kg,
    required this.share,
    required this.confidence,
    required this.region,
    this.quantity = 0,
    this.unit = '',
  });

  final String key;
  final String group;
  final String label;
  final double kg;

  /// Fraction of the month's total, 0 to 1.
  final double share;
  final String confidence;
  final String region;
  final double quantity;
  final String unit;

  /// Anything not marked high is shown with an "approximate" tag.
  bool get isApproximate => confidence != 'high';

  factory FootprintLine.fromMap(Map<String, dynamic> m) => FootprintLine(
        key: (m['key'] ?? '') as String,
        group: (m['group'] ?? '') as String,
        label: (m['label'] ?? '') as String,
        kg: _dbl(m['kg']),
        share: _dbl(m['share']),
        confidence: (m['confidence'] ?? 'low') as String,
        region: (m['region'] ?? '') as String,
        quantity: _dbl(m['quantity']),
        unit: (m['unit'] ?? '') as String,
      );
}

class FootprintComparison {
  const FootprintComparison({
    required this.indiaKgYear,
    required this.worldKgYear,
    required this.indiaYear,
    required this.worldYear,
    required this.ofIndia,
    required this.ofWorld,
  });

  final double indiaKgYear;
  final double worldKgYear;
  final int indiaYear;
  final int worldYear;
  final double ofIndia;
  final double ofWorld;

  factory FootprintComparison.fromMap(Map<String, dynamic> m) =>
      FootprintComparison(
        indiaKgYear: _dbl(m['indiaKgYear']),
        worldKgYear: _dbl(m['worldKgYear']),
        indiaYear: _int(m['indiaYear']),
        worldYear: _int(m['worldYear']),
        ofIndia: _dbl(m['ofIndia']),
        ofWorld: _dbl(m['ofWorld']),
      );
}

/// What the server worked out. The app does no emissions maths of its own.
class FootprintResult {
  const FootprintResult({
    required this.monthKg,
    required this.yearKg,
    required this.groups,
    required this.lines,
    required this.comparison,
    required this.factorsVersion,
  });

  final double monthKg;

  /// A projection: this month repeated twelve times.
  final double yearKg;

  /// electricity, cooking, transport, air.
  final Map<String, double> groups;
  final List<FootprintLine> lines;
  final FootprintComparison comparison;
  final String factorsVersion;

  factory FootprintResult.fromMap(Map<String, dynamic> m) {
    final groups = m['groups'];
    final lines = m['lines'];
    final comparison = m['comparison'];
    return FootprintResult(
      monthKg: _dbl(m['monthKg']),
      yearKg: _dbl(m['yearKg']),
      groups: groups is Map
          ? {for (final e in groups.entries) '${e.key}': _dbl(e.value)}
          : const {},
      lines: lines is List
          ? lines
              .whereType<Map<String, dynamic>>()
              .map(FootprintLine.fromMap)
              .toList()
          : const [],
      comparison: FootprintComparison.fromMap(
        comparison is Map<String, dynamic> ? comparison : const {},
      ),
      factorsVersion: (m['factorsVersion'] ?? '') as String,
    );
  }
}

/// A saved month, as stored.
class FootprintEntry extends Equatable {
  const FootprintEntry({
    required this.id,
    required this.monthKey,
    required this.monthKg,
    required this.yearKg,
    required this.electricityKg,
    required this.cookingKg,
    required this.transportKg,
    required this.airKg,
    required this.factorsVersion,
    required this.inputs,
  });

  final String id;

  /// "2026-10".
  final String monthKey;
  final double monthKg;
  final double yearKg;
  final double electricityKg;
  final double cookingKg;
  final double transportKg;
  final double airKg;
  final String factorsVersion;

  /// The numbers entered, so the month can be reopened and edited. Null if the
  /// stored copy is unreadable, which never blocks showing the totals.
  final FootprintInputs? inputs;

  DateTime? get month {
    final p = monthKey.split('-');
    if (p.length != 2) return null;
    final y = int.tryParse(p[0]);
    final m = int.tryParse(p[1]);
    return (y == null || m == null) ? null : DateTime(y, m);
  }

  /// "Oct 2026".
  String get label {
    final d = month;
    return d == null ? monthKey : DateFormat('MMM yyyy').format(d);
  }

  /// Three-letter month for chart axes.
  String get shortLabel {
    final d = month;
    return d == null ? monthKey : DateFormat('MMM').format(d);
  }

  factory FootprintEntry.fromMap(Map<String, dynamic> m) {
    FootprintInputs? inputs;
    final raw = m['inputs'];
    if (raw is String && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic>) {
          inputs = FootprintInputs.fromJson(decoded);
        }
      } catch (_) {
        inputs = null;
      }
    }
    return FootprintEntry(
      id: (m[r'$id'] ?? '') as String,
      monthKey: (m['monthKey'] ?? '') as String,
      monthKg: _dbl(m['monthKg']),
      yearKg: _dbl(m['yearKg']),
      electricityKg: _dbl(m['electricityKg']),
      cookingKg: _dbl(m['cookingKg']),
      transportKg: _dbl(m['transportKg']),
      airKg: _dbl(m['airKg']),
      factorsVersion: (m['factorsVersion'] ?? '') as String,
      inputs: inputs,
    );
  }

  @override
  List<Object?> get props => [id, monthKey, monthKg, factorsVersion];
}

class MethodFactor {
  const MethodFactor({
    required this.key,
    required this.label,
    required this.unit,
    required this.value,
    required this.region,
    required this.confidence,
    required this.source,
    required this.note,
  });

  final String key;
  final String label;
  final String unit;
  final double value;
  final String region;
  final String confidence;
  final String source;
  final String note;

  factory MethodFactor.fromMap(Map<String, dynamic> m) => MethodFactor(
        key: (m['key'] ?? '') as String,
        label: (m['label'] ?? '') as String,
        unit: (m['unit'] ?? '') as String,
        value: _dbl(m['value']),
        region: (m['region'] ?? '') as String,
        confidence: (m['confidence'] ?? 'low') as String,
        source: (m['source'] ?? '') as String,
        note: (m['note'] ?? '') as String,
      );
}

class MethodBenchmark {
  const MethodBenchmark({
    required this.label,
    required this.kgPerYear,
    required this.year,
    required this.source,
  });

  final String label;
  final double kgPerYear;
  final int year;
  final String source;

  factory MethodBenchmark.fromMap(Map<String, dynamic>? m) => MethodBenchmark(
        label: (m?['label'] ?? '') as String,
        kgPerYear: _dbl(m?['kgPerYear']),
        year: _int(m?['year']),
        source: (m?['source'] ?? '') as String,
      );
}

/// Every source, factor and limit behind the numbers, served by the server so
/// the explanation cannot disagree with the calculation.
class Methodology {
  const Methodology({
    required this.version,
    required this.retrieved,
    required this.scope,
    required this.factors,
    required this.india,
    required this.world,
    required this.exclusions,
    required this.caveats,
  });

  final String version;
  final String retrieved;
  final String scope;
  final List<MethodFactor> factors;
  final MethodBenchmark india;
  final MethodBenchmark world;
  final List<String> exclusions;
  final List<String> caveats;

  factory Methodology.fromMap(Map<String, dynamic> m) {
    List<String> strings(Object? v) =>
        v is List ? v.whereType<String>().toList() : const [];
    final benchmarks = m['benchmarks'];
    final factors = m['factors'];
    return Methodology(
      version: (m['version'] ?? '') as String,
      retrieved: (m['retrieved'] ?? '') as String,
      scope: (m['scope'] ?? '') as String,
      factors: factors is List
          ? factors
              .whereType<Map<String, dynamic>>()
              .map(MethodFactor.fromMap)
              .toList()
          : const [],
      india: MethodBenchmark.fromMap(
        benchmarks is Map<String, dynamic>
            ? benchmarks['india'] as Map<String, dynamic>?
            : null,
      ),
      world: MethodBenchmark.fromMap(
        benchmarks is Map<String, dynamic>
            ? benchmarks['world'] as Map<String, dynamic>?
            : null,
      ),
      exclusions: strings(m['exclusions']),
      caveats: strings(m['caveats']),
    );
  }
}

int _int(Object? v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is String) return int.tryParse(v) ?? fallback;
  return fallback;
}

double _dbl(Object? v, [double fallback = 0]) {
  if (v is double) return v;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? fallback;
  return fallback;
}
