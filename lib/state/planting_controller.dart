import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/services/api.dart';
import '../data/models/planting_request.dart';
import 'auth_controller.dart';

PlantingRequest _one(Map<String, dynamic> data) {
  final raw = data['request'];
  if (raw is! Map<String, dynamic>) {
    throw const ApiFailure('bad_response', 'Unexpected server response.');
  }
  return PlantingRequest.fromMap(raw);
}

/// The signed-in member's planting requests, newest first.
///
/// The server owns every rule (who may answer what, and when), so each action
/// here sends the call and then stores whatever the server says the request now
/// is, rather than guessing the next status on the client.
class PlantingController extends AsyncNotifier<List<PlantingRequest>> {
  @override
  Future<List<PlantingRequest>> build() async {
    final userId = ref.watch(currentUserIdProvider);
    if (userId == null) return const [];
    return _load();
  }

  Future<List<PlantingRequest>> _load() async {
    final data = await ref.read(apiProvider).myPlantingRequests();
    final raw = data['requests'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(PlantingRequest.fromMap)
        .toList();
  }

  /// Reloads the list. A failed reload keeps what is on screen, like the trees
  /// list does, so a network blip does not blank a request someone is reading.
  Future<void> refresh() async {
    try {
      state = AsyncData(await _load());
    } catch (e, st) {
      if (!state.hasValue) state = AsyncError(e, st);
    }
  }

  Future<PlantingRequest> create({
    double? lat,
    double? lng,
    String addressLabel = '',
    String note = '',
    DateTime? preferredFrom,
    DateTime? preferredTo,
  }) async {
    final made = _one(
      await ref.read(apiProvider).requestPlanting(
            lat: lat,
            lng: lng,
            addressLabel: addressLabel,
            note: note,
            preferredFrom: preferredFrom,
            preferredTo: preferredTo,
          ),
    );
    state = AsyncData([made, ...?state.value]);
    return made;
  }

  Future<PlantingRequest> respond(String id, {required bool accept}) async =>
      _replace(
        _one(
          await ref
              .read(apiProvider)
              .respondToPlanting(id: id, accept: accept),
        ),
      );

  Future<PlantingRequest> cancel(String id) async =>
      _replace(_one(await ref.read(apiProvider).cancelPlanting(id)));

  PlantingRequest _replace(PlantingRequest updated) {
    final current = state.value ?? const <PlantingRequest>[];
    state = AsyncData([
      for (final r in current) r.id == updated.id ? updated : r,
    ]);
    return updated;
  }
}

final plantingControllerProvider =
    AsyncNotifierProvider<PlantingController, List<PlantingRequest>>(
  PlantingController.new,
);

/// Requests waiting on the member: a place and time the NGO has proposed.
final plantingNeedingAnswerProvider = Provider<int>((ref) {
  final list = ref.watch(plantingControllerProvider).value ?? const [];
  return list.where((r) => r.needsAnswer).length;
});
