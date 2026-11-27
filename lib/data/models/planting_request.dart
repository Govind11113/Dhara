import 'package:equatable/equatable.dart';

/// Where a planting request is in its life.
///
/// `wire` values must match the `status` enum in scripts/schema.mjs and the
/// transition table in functions/api/src/lib/planting.js. The server owns the
/// rules; this only names the states so the screens can describe them.
enum PlantingStatus {
  open('open', 'Waiting for the NGO'),
  scheduled('scheduled', 'Place and time ready'),
  confirmed('confirmed', 'Confirmed'),
  declined('declined', 'Waiting for a new time'),
  completed('completed', 'Planted'),
  cancelled('cancelled', 'Cancelled');

  const PlantingStatus(this.wire, this.label);

  final String wire;
  final String label;

  static PlantingStatus parse(Object? v) => PlantingStatus.values.firstWhere(
        (s) => s.wire == v,
        orElse: () => PlantingStatus.open,
      );
}

/// A member's request for a place to plant a tree, and the NGO's answer.
class PlantingRequest extends Equatable {
  const PlantingRequest({
    required this.id,
    required this.status,
    required this.createdAt,
    this.lat,
    this.lng,
    this.addressLabel = '',
    this.note = '',
    this.preferredFrom,
    this.preferredTo,
    this.siteAddress = '',
    this.siteLat,
    this.siteLng,
    this.meetingAt,
    this.meetingPoint = '',
    this.replyNotes = '',
    this.userResponse = '',
  });

  final String id;
  final PlantingStatus status;
  final DateTime createdAt;

  // What the member asked for.
  final double? lat;
  final double? lng;
  final String addressLabel;
  final String note;
  final DateTime? preferredFrom;
  final DateTime? preferredTo;

  // What the NGO answered.
  final String siteAddress;
  final double? siteLat;
  final double? siteLng;
  final DateTime? meetingAt;
  final String meetingPoint;
  final String replyNotes;

  /// `accepted`, `declined` or empty.
  final String userResponse;

  bool get hasReply => siteAddress.trim().isNotEmpty && meetingAt != null;

  bool get hasSitePin => siteLat != null && siteLng != null;

  bool get hasPin => lat != null && lng != null;

  /// The member can confirm or decline only while a slot is waiting for them.
  bool get needsAnswer => status == PlantingStatus.scheduled;

  /// Mirrors the server: a confirmed request is not cancelled from the app,
  /// because the NGO is expecting the member.
  bool get canCancel =>
      status == PlantingStatus.open ||
      status == PlantingStatus.scheduled ||
      status == PlantingStatus.declined;

  /// Still in play, so it counts towards the member's limit of live requests.
  bool get isActive => status != PlantingStatus.completed &&
      status != PlantingStatus.cancelled;

  static DateTime? _date(Object? v) =>
      v is String ? DateTime.tryParse(v)?.toLocal() : null;

  static double? _num(Object? v) => v is num ? v.toDouble() : null;

  static String _text(Object? v) => v is String ? v : '';

  factory PlantingRequest.fromMap(Map<String, dynamic> m) => PlantingRequest(
        id: _text(m['id']),
        status: PlantingStatus.parse(m['status']),
        createdAt: _date(m['createdAt']) ?? DateTime.now(),
        lat: _num(m['lat']),
        lng: _num(m['lng']),
        addressLabel: _text(m['addressLabel']),
        note: _text(m['note']),
        preferredFrom: _date(m['preferredFrom']),
        preferredTo: _date(m['preferredTo']),
        siteAddress: _text(m['siteAddress']),
        siteLat: _num(m['siteLat']),
        siteLng: _num(m['siteLng']),
        meetingAt: _date(m['meetingAt']),
        meetingPoint: _text(m['meetingPoint']),
        replyNotes: _text(m['replyNotes']),
        userResponse: _text(m['userResponse']),
      );

  @override
  List<Object?> get props => [id, status, meetingAt, siteAddress, userResponse];
}

/// Why a request form cannot be sent yet, or null when it can.
///
/// The server checks all of this again; this exists so the person hears about it
/// before a round trip. Kept free of widgets so it can be tested directly.
String? planningProblem({
  required double? lat,
  required double? lng,
  required String address,
  DateTime? from,
  DateTime? to,
  DateTime? now,
}) {
  final today = now ?? DateTime.now();
  final hasPin = lat != null && lng != null;

  if (!hasPin && address.trim().length < 3) {
    return 'Share your location or type an address so the NGO can find you.';
  }
  if (from != null && to != null && to.isBefore(from)) {
    return 'The last date comes before the first.';
  }
  final last = to ?? from;
  if (last != null && last.isBefore(DateTime(today.year, today.month, today.day))) {
    return 'Pick dates from today onwards.';
  }
  if (from != null && to != null && to.difference(from).inDays > 180) {
    return 'Pick a range of six months or less.';
  }
  return null;
}
