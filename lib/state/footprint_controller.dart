import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/services/api.dart';
import '../data/models/footprint.dart';
import '../data/repository.dart';
import 'auth_controller.dart';

/// Everything the footprint screens ask of the server.
///
/// An interface so the screens can be tested without a network. The app does no
/// emissions maths itself: it sends what the person typed and shows what comes
/// back, so there is one implementation of the calculation.
abstract class FootprintService {
  Future<FootprintResult> estimate(FootprintInputs inputs);
  Future<FootprintResult> save(FootprintInputs inputs, String monthKey);
  Future<void> delete(String monthKey);
  Future<Methodology> methodology();
}

class ApiFootprintService implements FootprintService {
  ApiFootprintService(this._api);

  final Api _api;

  FootprintResult _result(Map<String, dynamic> data) {
    final f = data['footprint'];
    if (f is! Map<String, dynamic>) {
      throw const ApiFailure('bad_response', 'Unexpected server response.');
    }
    return FootprintResult.fromMap(f);
  }

  @override
  Future<FootprintResult> estimate(FootprintInputs inputs) async => _result(
        await _api.postIdempotent('/footprint/estimate', {'inputs': inputs.toJson()}),
      );

  @override
  Future<FootprintResult> save(FootprintInputs inputs, String monthKey) async =>
      _result(
        await _api.postIdempotent('/footprint/save', {
          'inputs': inputs.toJson(),
          'monthKey': monthKey,
        }),
      );

  @override
  Future<void> delete(String monthKey) async {
    await _api.postIdempotent('/footprint/delete', {'monthKey': monthKey});
  }

  @override
  Future<Methodology> methodology() async =>
      Methodology.fromMap(await _api.postIdempotent('/footprint/methodology'));
}

final footprintServiceProvider =
    Provider<FootprintService>((ref) => ApiFootprintService(ref.watch(apiProvider)));

/// The member's saved months, newest first.
///
/// `retry: null`: Riverpod 3 would otherwise re-run a failing provider up to ten
/// times with backoff, leaving a card on "loading" for ~40 s when offline.
final footprintHistoryProvider = FutureProvider<List<FootprintEntry>>(
  (ref) async {
    final userId = ref.watch(currentUserIdProvider);
    if (userId == null) return const [];
    return ref.watch(repositoryProvider).myFootprints(userId);
  },
  retry: (_, _) => null,
);

final methodologyProvider = FutureProvider<Methodology>(
  (ref) => ref.watch(footprintServiceProvider).methodology(),
  retry: (_, _) => null,
);
