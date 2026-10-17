// Throwaway compile check for the Riverpod 3.4.3 API surface this app relies on.
// Deleted immediately after `dart analyze` confirms the shapes.
import 'package:flutter_riverpod/flutter_riverpod.dart';

// 1. Plain Notifier with sync state + does `ref` exist on the notifier?
class CounterNotifier extends Notifier<int> {
  @override
  int build() => 0;

  void bump() {
    state = state + 1;
    ref.invalidate(sampleFutureProvider);
  }
}

final counterProvider = NotifierProvider<CounterNotifier, int>(
  CounterNotifier.new,
);

// 2. AsyncNotifier for server-backed state.
class ThingNotifier extends AsyncNotifier<List<String>> {
  @override
  Future<List<String>> build() async => const ['a'];

  Future<void> reload() async {
    state = const AsyncValue<List<String>>.loading();
    state = await AsyncValue.guard(() async => const ['b']);
  }
}

final thingProvider =
    AsyncNotifierProvider<ThingNotifier, List<String>>(ThingNotifier.new);

// 3. FutureProvider + family + keepAlive + watching another provider.
final sampleFutureProvider = FutureProvider<int>((ref) async {
  ref.keepAlive();
  return 1;
});

final familyProvider = FutureProvider.family<String, String>((ref, id) async {
  final n = await ref.watch(sampleFutureProvider.future);
  return '$id$n';
});

// 4. Provider that reads another provider's notifier.
final derivedProvider = Provider<int>((ref) {
  final count = ref.watch(counterProvider);
  ref.read(counterProvider.notifier).bump();
  return count;
});

// 5. StreamProvider still exported?
final streamProvider = StreamProvider<int>((ref) => Stream.value(1));
