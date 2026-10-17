import 'package:equatable/equatable.dart';

enum PartyRole {
  factory('factory', 'Factory'),
  wholesaler('wholesaler', 'Wholesaler'),
  retailer('retailer', 'Retailer'),
  consumer('consumer', 'Consumer');

  const PartyRole(this.wire, this.label);
  final String wire;
  final String label;

  static PartyRole parse(Object? v) => PartyRole.values.firstWhere(
        (r) => r.wire == v,
        orElse: () => PartyRole.consumer,
      );
}

enum ItemState {
  atFactory('at_factory', 'At factory', PartyRole.factory),
  withWholesaler('with_wholesaler', 'With wholesaler', PartyRole.wholesaler),
  withRetailer('with_retailer', 'With retailer', PartyRole.retailer),
  withConsumer('with_consumer', 'With you', PartyRole.consumer),
  returnedToRetailer('returned_to_retailer', 'Returned to retailer', PartyRole.retailer),
  returnedToWholesaler('returned_to_wholesaler', 'Back to wholesaler', PartyRole.wholesaler),
  returnedToFactory('returned_to_factory', 'Back at factory', PartyRole.factory),
  recycled('recycled', 'Recycled', PartyRole.factory),
  voided('voided', 'Void', PartyRole.factory);

  const ItemState(this.wire, this.label, this.holder);
  final String wire;
  final String label;
  final PartyRole holder;

  static ItemState parse(Object? v) => ItemState.values.firstWhere(
        (s) => s.wire == v,
        orElse: () => ItemState.atFactory,
      );

  /// Where the item sits on the 0..1 journey bar shown in the app.
  double get journeyProgress => switch (this) {
        ItemState.atFactory => 0.0,
        ItemState.withWholesaler => 0.16,
        ItemState.withRetailer => 0.32,
        ItemState.withConsumer => 0.5,
        ItemState.returnedToRetailer => 0.66,
        ItemState.returnedToWholesaler => 0.8,
        ItemState.returnedToFactory => 0.92,
        ItemState.recycled => 1.0,
        ItemState.voided => 0.0,
      };
}

enum TransferDirection {
  forward('forward'),
  returnLeg('return'),
  recycle('recycle');

  const TransferDirection(this.wire);
  final String wire;

  static TransferDirection parse(Object? v) =>
      TransferDirection.values.firstWhere(
        (d) => d.wire == v,
        orElse: () => TransferDirection.forward,
      );
}

/// The single source of truth for legal custody moves.
///
/// Mirrored byte-for-byte in the `transfer` Appwrite Function — the client copy
/// exists only to fail fast and show a helpful message. The server decides.
class CustodyRules {
  const CustodyRules._();

  static const _transitions = <ItemState, ItemState>{
    ItemState.atFactory: ItemState.withWholesaler,
    ItemState.withWholesaler: ItemState.withRetailer,
    ItemState.withRetailer: ItemState.withConsumer,
    ItemState.withConsumer: ItemState.returnedToRetailer,
    ItemState.returnedToRetailer: ItemState.returnedToWholesaler,
    ItemState.returnedToWholesaler: ItemState.returnedToFactory,
    ItemState.returnedToFactory: ItemState.recycled,
  };

  /// Exactly one state may follow any given state. Anything else is rejected,
  /// which kills replay and skip-ahead attacks by construction.
  static ItemState? next(ItemState from) => _transitions[from];

  /// Who must be holding the item to initiate the move.
  static PartyRole? senderRole(ItemState from) =>
      _transitions.containsKey(from) ? from.holder : null;

  /// Who legitimately receives it.
  static PartyRole? receiverRole(ItemState from) => next(from)?.holder;

  static TransferDirection directionFor(ItemState from) {
    if (from == ItemState.returnedToFactory) return TransferDirection.recycle;
    const forward = {
      ItemState.atFactory,
      ItemState.withWholesaler,
      ItemState.withRetailer,
    };
    return forward.contains(from)
        ? TransferDirection.forward
        : TransferDirection.returnLeg;
  }

  /// Consumers earn only on the return leg, once per cycle. Paying at purchase
  /// would let someone farm credits by buying and never returning.
  static bool awardsConsumerCredit(ItemState from) =>
      from == ItemState.withConsumer;

  static bool isTerminal(ItemState s) =>
      s == ItemState.recycled || s == ItemState.voided;

  static String explain(ItemState from, PartyRole actor) {
    final expected = senderRole(from);
    if (expected == null) {
      return 'This item is ${from.label.toLowerCase()} and cannot move again.';
    }
    if (expected != actor) {
      return 'Only a ${expected.label.toLowerCase()} can pass this on right now.';
    }
    return 'Ready to hand over to a ${receiverRole(from)!.label.toLowerCase()}.';
  }
}

enum ProductType {
  petBottle('pet_bottle', 'PET bottle', '\u{1F9F4}', 2),
  glassBottle('glass_bottle', 'Glass bottle', '\u{1F37E}', 3),
  aluminiumCan('aluminium_can', 'Aluminium can', '\u{1F964}', 3),
  tetraCarton('tetra_carton', 'Tetra carton', '\u{1F9C3}', 2),
  ewaste('ewaste', 'E-waste', '\u{1F50C}', 8),
  other('other', 'Packaging', '\u{267B}', 1);

  const ProductType(this.wire, this.label, this.emoji, this.defaultCredits);
  final String wire;
  final String label;
  final String emoji;
  final int defaultCredits;

  static ProductType parse(Object? v) => ProductType.values.firstWhere(
        (p) => p.wire == v,
        orElse: () => ProductType.other,
      );
}

class TrackedItem extends Equatable {
  const TrackedItem({
    required this.id,
    required this.code,
    required this.productType,
    required this.state,
    required this.holderId,
    required this.holderRole,
    this.productName = '',
    this.brandName = '',
    this.sizeMl = 0,
    this.creditValue = 0,
    this.cycleCount = 0,
    this.transferCount = 0,
    this.lastTransferAt,
    this.rewardClaimedThisCycle = false,
  });

  final String id;
  final String code;
  final ProductType productType;
  final ItemState state;
  final String holderId;
  final PartyRole holderRole;
  final String productName;
  final String brandName;
  final int sizeMl;
  final int creditValue;
  final int cycleCount;
  final int transferCount;
  final DateTime? lastTransferAt;
  final bool rewardClaimedThisCycle;

  factory TrackedItem.fromMap(Map<String, dynamic> m) => TrackedItem(
        id: (m[r'$id'] ?? '') as String,
        code: (m['code'] ?? '') as String,
        productType: ProductType.parse(m['productType']),
        state: ItemState.parse(m['state']),
        holderId: (m['holderId'] ?? '') as String,
        holderRole: PartyRole.parse(m['holderRole']),
        productName: (m['productName'] ?? '') as String,
        brandName: (m['brandName'] ?? '') as String,
        sizeMl: _int(m['sizeMl']),
        creditValue: _int(m['creditValue']),
        cycleCount: _int(m['cycleCount']),
        transferCount: _int(m['transferCount']),
        lastTransferAt: _date(m['lastTransferAt']),
        rewardClaimedThisCycle: m['rewardClaimedThisCycle'] == true,
      );

  String get title {
    if (productName.isNotEmpty) return productName;
    if (sizeMl > 0) return '${productType.label} \u00B7 ${sizeMl}ml';
    return productType.label;
  }

  int get effectiveCredits =>
      creditValue > 0 ? creditValue : productType.defaultCredits;

  @override
  List<Object?> get props => [id, state, holderId, cycleCount];
}

class CustodyEvent extends Equatable {
  const CustodyEvent({
    required this.id,
    required this.itemId,
    required this.fromState,
    required this.toState,
    required this.direction,
    required this.occurredAt,
    this.fromRole = PartyRole.factory,
    this.toRole = PartyRole.consumer,
    this.creditsAwarded = 0,
    this.distanceM = 0,
  });

  final String id;
  final String itemId;
  final String fromState;
  final String toState;
  final TransferDirection direction;
  final DateTime occurredAt;
  final PartyRole fromRole;
  final PartyRole toRole;
  final int creditsAwarded;
  final double distanceM;

  factory CustodyEvent.fromMap(Map<String, dynamic> m) => CustodyEvent(
        id: (m[r'$id'] ?? '') as String,
        itemId: (m['itemId'] ?? '') as String,
        fromState: (m['fromState'] ?? '') as String,
        toState: (m['toState'] ?? '') as String,
        direction: TransferDirection.parse(m['direction']),
        occurredAt: _date(m['occurredAt']) ?? DateTime.now(),
        fromRole: PartyRole.parse(m['fromRole']),
        toRole: PartyRole.parse(m['toRole']),
        creditsAwarded: _int(m['creditsAwarded']),
        distanceM: _dbl(m['distanceM']),
      );

  ItemState get to => ItemState.parse(toState);

  @override
  List<Object?> get props => [id, toState, occurredAt];
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

DateTime? _date(Object? v) {
  if (v is String && v.isNotEmpty) return DateTime.tryParse(v);
  return null;
}
