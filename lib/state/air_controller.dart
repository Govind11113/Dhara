import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/services/air_quality.dart';
import '../core/services/location.dart';

final airQualityServiceProvider = Provider<AirQualityService>((ref) {
  final service = AirQualityService();
  ref.onDispose(service.close);
  return service;
});

/// Where the user is, for context only.
///
/// Passive on purpose: it never shows a permission dialog, so opening the
/// dashboard cannot ambush someone who has not asked for anything. Null means
/// "access not granted yet" and the card offers a button instead.
///
/// `retry: null` on both providers below: Riverpod 3 otherwise re-runs a
/// failing provider up to ten times with backoff, which keeps a card on
/// "loading" for around forty seconds when the phone is simply offline.
final passiveLocationProvider = FutureProvider<LocationFix?>(
  (ref) => ref.watch(locationServiceProvider).passiveFix(),
  retry: (_, _) => null,
);

/// Air quality at the user's location, or null when there is no location.
/// Throws [AirQualityException] when the service cannot be reached.
final airQualityProvider = FutureProvider<AirQuality?>(
  (ref) async {
    final fix = await ref.watch(passiveLocationProvider.future);
    if (fix == null) return null;
    return ref.watch(airQualityServiceProvider).fetch(fix.lat, fix.lng);
  },
  retry: (_, _) => null,
);
