import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/services/weather.dart';

final weatherServiceProvider = Provider<WeatherService>((ref) {
  final service = WeatherService();
  ref.onDispose(service.close);
  return service;
});

/// The forecast for a tree's area, keyed by its rounded coordinates so trees in
/// the same neighbourhood share one request.
///
/// `retry: null`: Riverpod 3 would otherwise retry a failure up to ten times,
/// which leaves a card on "loading" for about forty seconds when offline.
final forecastProvider = FutureProvider.family<Forecast, ({double lat, double lng})>(
  (ref, where) => ref.watch(weatherServiceProvider).fetch(where.lat, where.lng),
  retry: (_, _) => null,
);
