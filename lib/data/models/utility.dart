import 'package:equatable/equatable.dart';

/// Household utility verification, as the server reports it.
///
/// The app keeps no provider list of its own and does no carbon maths: both
/// come from `/utilities/*` so there is one source for each.

enum UtilityType {
  electricity('electricity', 'Electricity', 'kWh'),
  png('png', 'Piped gas', 'SCM');

  const UtilityType(this.wire, this.label, this.unit);
  final String wire;
  final String label;
  final String unit;

  static UtilityType parse(Object? v) => UtilityType.values.firstWhere(
    (t) => t.wire == v,
    orElse: () => UtilityType.electricity,
  );
}

/// Every status the server can report. Only [verified] means the utility
/// itself supplied the consumption.
enum UtilityStatus {
  pending('pending'),
  fetching('fetching'),
  verified('verified'),
  documentReview('document_review'),
  unverified('unverified'),
  failed('failed'),
  unsupportedProvider('unsupported_provider'),
  providerUnavailable('provider_unavailable'),
  consumptionUnavailable('consumption_unavailable'),
  duplicate('duplicate');

  const UtilityStatus(this.wire);
  final String wire;

  static UtilityStatus parse(Object? v) => UtilityStatus.values.firstWhere(
    (s) => s.wire == v,
    orElse: () => UtilityStatus.failed,
  );

  /// Short label for a status pill.
  String get label => switch (this) {
    UtilityStatus.pending => 'Pending',
    UtilityStatus.fetching => 'Fetching',
    UtilityStatus.verified => 'Verified',
    UtilityStatus.documentReview => 'Pending review',
    UtilityStatus.unverified => 'Unverified',
    UtilityStatus.failed => 'Failed',
    UtilityStatus.unsupportedProvider => 'Not available',
    UtilityStatus.providerUnavailable => 'Unavailable',
    UtilityStatus.consumptionUnavailable => 'No consumption',
    UtilityStatus.duplicate => 'Already imported',
  };

  /// What the result screen says when the server sent no message of its own.
  String get explanation => switch (this) {
    UtilityStatus.pending => 'Your request has been received.',
    UtilityStatus.fetching => 'Fetching your bill from the provider.',
    UtilityStatus.verified => 'Consumption retrieved from your provider.',
    UtilityStatus.documentReview =>
      'Read from your uploaded bill. It is pending review and is not '
          'treated as verified.',
    UtilityStatus.unverified => 'Entered by you. It is saved as unverified.',
    UtilityStatus.failed =>
      'The provider could not return a bill for this account. Check the '
          'number, or upload your bill instead.',
    UtilityStatus.unsupportedProvider =>
      'Automatic verification is currently unavailable for this provider. '
          'You can upload your bill for verification.',
    UtilityStatus.providerUnavailable =>
      'The provider could not be reached right now. Try again later, or '
          'upload your bill instead.',
    UtilityStatus.consumptionUnavailable =>
      'Your bill was retrieved successfully, but actual consumption data '
          'was not available. Please upload your bill or enter your '
          'consumption manually.',
    UtilityStatus.duplicate =>
      'This billing period was already imported, so it was not added again.',
  };

  /// Where to send the user next.
  bool get offersUpload =>
      this == UtilityStatus.failed ||
      this == UtilityStatus.unsupportedProvider ||
      this == UtilityStatus.providerUnavailable ||
      this == UtilityStatus.consumptionUnavailable;
}

/// How a reading's figure was obtained, for the "source" line under it.
String sourceLabel(UtilityStatus status) => switch (status) {
  UtilityStatus.verified => 'Official provider data \u2014 verified',
  UtilityStatus.documentReview =>
    'Extracted from uploaded bill \u2014 verification pending',
  _ => 'User-entered \u2014 not independently verified',
};

class UtilityRegion {
  const UtilityRegion({
    required this.country,
    required this.countryName,
    required this.states,
  });

  final String country;
  final String countryName;
  final List<({String code, String name})> states;

  factory UtilityRegion.fromMap(Map<String, dynamic> m) => UtilityRegion(
    country: (m['country'] ?? '') as String,
    countryName: (m['countryName'] ?? '') as String,
    states: [
      for (final s in (m['states'] as List? ?? const []).whereType<Map>())
        (code: (s['code'] ?? '') as String, name: (s['name'] ?? '') as String),
    ],
  );
}

class UtilityProvider extends Equatable {
  const UtilityProvider({
    required this.id,
    required this.utilityType,
    required this.state,
    required this.name,
    required this.accountLabel,
    required this.accountHelp,
    required this.accountPattern,
    required this.consumptionUnit,
    this.serviceAreas = const [],
  });

  final String id;
  final UtilityType utilityType;
  final String state;
  final String name;
  final String accountLabel;
  final String accountHelp;
  final String accountPattern;
  final String consumptionUnit;
  final List<String> serviceAreas;

  factory UtilityProvider.fromMap(Map<String, dynamic> m) => UtilityProvider(
    id: (m['id'] ?? '') as String,
    utilityType: UtilityType.parse(m['utilityType']),
    state: (m['state'] ?? '') as String,
    name: (m['name'] ?? '') as String,
    accountLabel: (m['accountLabel'] ?? 'Account number') as String,
    accountHelp: (m['accountHelp'] ?? '') as String,
    accountPattern: (m['accountPattern'] ?? r'^[A-Z0-9-]{6,20}$') as String,
    consumptionUnit: (m['consumptionUnit'] ?? 'kWh') as String,
    serviceAreas: [
      for (final a in (m['serviceAreas'] as List? ?? const [])) '$a',
    ],
  );

  /// The identifier the way the server compares it.
  static String normalize(String raw) =>
      raw.trim().toUpperCase().replaceAll(RegExp(r'\s+'), '');

  /// Mirrors the server's check so the user is told before a round trip.
  String? validateAccount(String? raw) {
    final v = normalize(raw ?? '');
    if (v.isEmpty) return 'Enter your ${accountLabel.toLowerCase()}';
    if (!RegExp(accountPattern).hasMatch(v)) {
      return 'That does not look like a valid ${accountLabel.toLowerCase()}. $accountHelp';
    }
    return null;
  }

  @override
  List<Object?> get props => [id];
}

class UtilityCatalog {
  const UtilityCatalog({
    required this.regions,
    required this.providers,
    required this.consentVersion,
    required this.consentPurpose,
    this.fromServer = true,
    this.serverProblem,
  });

  final List<UtilityRegion> regions;
  final List<UtilityProvider> providers;
  final String consentVersion;
  final String consentPurpose;

  /// False when the server could not supply the list and the copy bundled in
  /// the app is shown instead. Picking a provider still works; saving needs the
  /// server, and [serverProblem] says why it is not there.
  final bool fromServer;
  final String? serverProblem;

  UtilityCatalog bundled(String problem) => UtilityCatalog(
    regions: regions,
    providers: providers,
    consentVersion: consentVersion,
    consentPurpose: consentPurpose,
    fromServer: false,
    serverProblem: problem,
  );

  factory UtilityCatalog.fromMap(Map<String, dynamic> m) {
    final consent = m['consent'] is Map ? m['consent'] as Map : const {};
    return UtilityCatalog(
      regions: [
        for (final r
            in (m['regions'] as List? ?? const [])
                .whereType<Map<String, dynamic>>())
          UtilityRegion.fromMap(r),
      ],
      providers: [
        for (final p
            in (m['providers'] as List? ?? const [])
                .whereType<Map<String, dynamic>>())
          UtilityProvider.fromMap(p),
      ],
      consentVersion: (consent['version'] ?? '') as String,
      consentPurpose: (consent['purpose'] ?? '') as String,
    );
  }

  List<UtilityProvider> forType(UtilityType type, {String? state}) => providers
      .where(
        (p) => p.utilityType == type && (state == null || p.state == state),
      )
      .toList(growable: false);
}

class UtilityReading extends Equatable {
  const UtilityReading({
    required this.id,
    required this.utilityType,
    required this.providerName,
    required this.accountMasked,
    required this.status,
    required this.periodStart,
    required this.periodEnd,
    required this.consumptionValue,
    required this.consumptionUnit,
    this.billAmount,
    this.carbonKg,
    this.carbonPending = false,
    this.appliedMonthKey,
    this.fetchedAt,
  });

  final String id;
  final UtilityType utilityType;
  final String providerName;
  final String accountMasked;
  final UtilityStatus status;
  final DateTime periodStart;
  final DateTime periodEnd;
  final double consumptionValue;
  final String consumptionUnit;
  final double? billAmount;
  final double? carbonKg;

  /// No verified emission factor for this unit yet (piped gas today).
  final bool carbonPending;

  /// The footprint month this reading is counted in, if any.
  final String? appliedMonthKey;
  final DateTime? fetchedAt;

  /// The month this bill counts towards: the month its period ends in.
  String get monthKey =>
      '${periodEnd.year.toString().padLeft(4, '0')}-${periodEnd.month.toString().padLeft(2, '0')}';

  factory UtilityReading.fromMap(Map<String, dynamic> m) => UtilityReading(
    id: (m['id'] ?? '') as String,
    utilityType: UtilityType.parse(m['utilityType']),
    providerName: (m['providerName'] ?? '') as String,
    accountMasked: (m['accountMasked'] ?? '') as String,
    status: UtilityStatus.parse(m['status']),
    periodStart: _day(m['periodStart']),
    periodEnd: _day(m['periodEnd']),
    consumptionValue: (m['consumptionValue'] as num?)?.toDouble() ?? 0,
    consumptionUnit: (m['consumptionUnit'] ?? '') as String,
    billAmount: (m['billAmount'] as num?)?.toDouble(),
    carbonKg: (m['carbonKg'] as num?)?.toDouble(),
    carbonPending: m['carbonStatus'] == 'pending_factor',
    appliedMonthKey: m['appliedMonthKey'] as String?,
    fetchedAt: DateTime.tryParse('${m['fetchedAt'] ?? ''}'),
  );

  @override
  List<Object?> get props => [id, status, appliedMonthKey];
}

class UtilityVerification {
  const UtilityVerification({
    required this.id,
    required this.utilityType,
    required this.providerName,
    required this.accountMasked,
    required this.status,
    this.reason,
    this.message,
    this.reading,
  });

  final String id;
  final UtilityType utilityType;
  final String providerName;
  final String accountMasked;
  final UtilityStatus status;
  final String? reason;
  final String? message;
  final UtilityReading? reading;

  /// The server's own wording when it has one, otherwise the status's.
  String get explanation =>
      (message != null && message!.isNotEmpty) ? message! : status.explanation;

  factory UtilityVerification.fromMap(Map<String, dynamic> m) =>
      UtilityVerification(
        id: (m['id'] ?? '') as String,
        utilityType: UtilityType.parse(m['utilityType']),
        providerName: (m['providerName'] ?? '') as String,
        accountMasked: (m['accountMasked'] ?? '') as String,
        status: UtilityStatus.parse(m['status']),
        reason: m['reason'] as String?,
        message: m['message'] as String?,
        reading: m['reading'] is Map<String, dynamic>
            ? UtilityReading.fromMap(m['reading'] as Map<String, dynamic>)
            : null,
      );
}

/// Figures the phone read off a bill. Suggestions only; the user confirms.
class ExtractedBill {
  const ExtractedBill({
    this.consumptionValue,
    this.previousReading,
    this.currentReading,
    this.periodStart,
    this.periodEnd,
  });

  final double? consumptionValue;
  final double? previousReading;
  final double? currentReading;
  final DateTime? periodStart;
  final DateTime? periodEnd;

  factory ExtractedBill.fromMap(Map<String, dynamic> m) => ExtractedBill(
    consumptionValue: (m['consumptionValue'] as num?)?.toDouble(),
    previousReading: (m['previousReading'] as num?)?.toDouble(),
    currentReading: (m['currentReading'] as num?)?.toDouble(),
    periodStart: DateTime.tryParse('${m['periodStart'] ?? ''}'),
    periodEnd: DateTime.tryParse('${m['periodEnd'] ?? ''}'),
  );
}

DateTime _day(Object? v) => DateTime.tryParse('${v ?? ''}') ?? DateTime(1970);

/// YYYY-MM-DD, the format the server expects.
String isoDay(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
