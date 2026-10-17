import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/services/api.dart';
import '../core/services/location.dart';
import '../data/models/item.dart';
import '../data/repository.dart';
import 'auth_controller.dart';

/// A handshake token the sender displays as a QR code.
class HandoverToken {
  const HandoverToken({
    required this.token,
    required this.expiresAt,
    required this.itemCount,
    required this.fromState,
    required this.toState,
    required this.receiverRole,
    this.items = const [],
  });

  final String token;
  final DateTime expiresAt;
  final int itemCount;
  final ItemState fromState;
  final ItemState toState;
  final PartyRole receiverRole;
  final List<String> items;

  Duration get remaining {
    final d = expiresAt.difference(DateTime.now());
    return d.isNegative ? Duration.zero : d;
  }

  bool get isExpired => remaining == Duration.zero;
}

/// Result of the receiver scanning a token.
class ClaimResult {
  const ClaimResult({
    required this.movedCount,
    required this.creditsAwardedToSender,
    this.skipped = const [],
    this.receiverRole = PartyRole.consumer,
  });

  final int movedCount;
  final int creditsAwardedToSender;
  final List<String> skipped;
  final PartyRole receiverRole;

  bool get hasSkipped => skipped.isNotEmpty;
}

/// Where an item sits in its lifecycle, plus its audit trail.
class ItemJourney {
  const ItemJourney({
    required this.item,
    required this.isYours,
    required this.canTransfer,
    required this.yourRole,
    this.nextState,
    this.history = const [],
  });

  final TrackedItem item;
  final bool isYours;
  final bool canTransfer;
  final PartyRole yourRole;
  final ItemState? nextState;
  final List<CustodyEvent> history;
}

/// Items currently held by the signed-in user.
class ItemsController extends AsyncNotifier<List<TrackedItem>> {
  @override
  Future<List<TrackedItem>> build() async {
    final userId = ref.watch(currentUserIdProvider);
    if (userId == null) return const [];
    return ref.watch(repositoryProvider).myItems(userId);
  }

  Future<void> refresh() async {
    state = AsyncValue.data(await build());
  }

  /// Sender step. Locks the scanned items and returns a short-lived token.
  ///
  /// Location is best-effort: a handover still works indoors without GPS, and
  /// the server simply skips the proximity check when coordinates are absent.
  Future<HandoverToken> issue(List<String> codes) async {
    final fix = await ref.read(locationServiceProvider).quickFix();

    final data = await ref.read(apiProvider).issueTransfer(
          codes: codes,
          lat: fix?.lat,
          lng: fix?.lng,
        );

    await refresh();

    final from = ItemState.parse(data['fromState']);
    return HandoverToken(
      token: (data['token'] ?? '') as String,
      expiresAt: DateTime.tryParse((data['expiresAt'] ?? '') as String) ??
          DateTime.now().add(const Duration(seconds: 90)),
      itemCount: _int(data['itemCount']),
      fromState: from,
      toState: ItemState.parse(data['toState']),
      receiverRole: PartyRole.parse(data['receiverRole']),
      items: _codesOf(data['items']),
    );
  }

  /// Receiver step. Consumes the token and advances each item one legal state.
  Future<ClaimResult> claim(String token) async {
    final fix = await ref.read(locationServiceProvider).quickFix();

    final data = await ref.read(apiProvider).claimTransfer(
          token: token,
          lat: fix?.lat,
          lng: fix?.lng,
        );

    await refresh();
    // Claiming can pay the *sender* on a return leg, and the receiver's own
    // holdings changed, so refresh the profile either way.
    await ref.read(authControllerProvider.notifier).refreshProfile();

    return ClaimResult(
      movedCount: _int(data['movedCount']),
      creditsAwardedToSender: _int(data['creditsAwardedToSender']),
      skipped: _skippedCodes(data['skipped']),
      receiverRole: PartyRole.parse(data['receiverRole']),
    );
  }

  /// Polls until the displayed token is consumed by the other party.
  ///
  /// Credits for a return are minted when the *receiver* claims, so the sender's
  /// screen has no other way to learn the handover completed. Returns true once
  /// the items have left this user's hands, false if the token expired first.
  Future<bool> awaitHandover(
    HandoverToken token, {
    Duration interval = const Duration(seconds: 3),
  }) async {
    final watching = token.items.toSet();
    // With no codes to watch, the "no longer held" test below is trivially
    // true, which would report a completed handover that never happened.
    if (watching.isEmpty) return false;

    while (!token.isExpired) {
      await Future<void>.delayed(interval);

      final userId = ref.read(currentUserIdProvider);
      if (userId == null) return false;

      try {
        final mine = await ref.read(repositoryProvider).myItems(userId);
        final stillHeld = mine.map((i) => i.code).toSet();
        if (watching.intersection(stillHeld).isEmpty) {
          await refresh();
          await ref.read(authControllerProvider.notifier).refreshProfile();
          return true;
        }
      } catch (_) {
        // Transient network trouble: keep waiting until the token expires.
      }
    }
    return false;
  }

  Future<ItemJourney> lookup(String code) async {
    final data = await ref.read(apiProvider).lookupItem(code);

    final raw = data['item'];
    final map = raw is Map<String, dynamic> ? raw : <String, dynamic>{};
    final history = data['history'];

    return ItemJourney(
      item: TrackedItem.fromMap(map),
      isYours: data['isYours'] == true,
      canTransfer: data['canTransfer'] == true,
      yourRole: PartyRole.parse(data['yourRole']),
      nextState: data['nextState'] == null
          ? null
          : ItemState.parse(data['nextState']),
      history: history is List
          ? history
              .whereType<Map<String, dynamic>>()
              .map(CustodyEvent.fromMap)
              .toList()
          : const [],
    );
  }
}

final itemsControllerProvider =
    AsyncNotifierProvider<ItemsController, List<TrackedItem>>(
  ItemsController.new,
);

/// Items the user is holding that are ready to be handed back for recycling.
final returnableItemsProvider = Provider<List<TrackedItem>>((ref) {
  final items = ref.watch(itemsControllerProvider).value ?? const <TrackedItem>[];
  return items
      .where((i) => CustodyRules.next(i.state) != null)
      .toList(growable: false);
});

final itemJourneyProvider =
    FutureProvider.family<ItemJourney, String>((ref, code) {
  return ref.watch(itemsControllerProvider.notifier).lookup(code);
});

List<String> _codesOf(Object? v) {
  if (v is! List) return const [];
  return v
      .whereType<Map>()
      .map((m) => m['code'])
      .whereType<String>()
      .toList(growable: false);
}

/// Skipped entries arrive as a plain code, `{code, reason}`, or — when the item
/// could not be loaded at all — `{itemId, reason}`. Every entry must survive
/// into the list: a silently dropped one reads to the user as a successful
/// transfer of an item that never moved.
List<String> _skippedCodes(Object? v) {
  if (v is! List) return const [];
  return v
      .map((e) {
        if (e is String) return e;
        if (e is Map) {
          final label = e['code'] ?? e['itemId'];
          final reason = e['reason'];
          final name = label is String && label.isNotEmpty ? label : 'Unknown item';
          return reason is String && reason.isNotEmpty ? '$name — $reason' : name;
        }
        return null;
      })
      .whereType<String>()
      .toList(growable: false);
}

int _int(Object? v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is String) return int.tryParse(v) ?? fallback;
  return fallback;
}
