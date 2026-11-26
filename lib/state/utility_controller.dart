import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:appwrite/appwrite.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/env.dart';
import '../core/services/api.dart';
import '../core/services/appwrite.dart';
import '../core/services/media.dart';
import '../core/services/vision.dart';
import '../core/utils/errors.dart';
import '../data/models/utility.dart';
import 'auth_controller.dart';

/// Everything the utility screens ask of the server. An interface so the
/// screens can be tested without a network. No bill data or credentials live
/// in the app: the server talks to providers and returns normalised results.
abstract class UtilityService {
  Future<UtilityCatalog> catalog();

  Future<ExtractedBill> extract({
    required UtilityType type,
    required String ocrText,
  });

  Future<UtilityVerification> submitBill({
    required UtilityType type,
    required String providerId,
    required String account,
    required String requestId,
    required String consentVersion,
    required double consumption,
    required DateTime periodStart,
    required DateTime periodEnd,
    String? billFileId,
    String ocrText = '',
    double? previousReading,
    double? currentReading,
  });

  Future<List<UtilityReading>> history({UtilityType? type});

  Future<int> deleteAll();
}

class ApiUtilityService implements UtilityService {
  ApiUtilityService(this._api, {Future<String> Function()? bundledList})
    : _bundledList =
          bundledList ??
          (() => rootBundle.loadString('assets/config/utility_providers.json'));

  final Api _api;
  final Future<String> Function() _bundledList;

  /// Providers from the server, or the copy shipped with the app when the
  /// server cannot be asked. Listing providers needs no bill-fetch credentials
  /// and no network, so a server problem must not stop someone choosing their
  /// provider. A backend test keeps the bundled copy identical to the server's
  /// registry.
  @override
  Future<UtilityCatalog> catalog() async {
    try {
      return UtilityCatalog.fromMap(
        await _api.postIdempotent('/utilities/providers'),
      );
    } catch (e) {
      final bundled = UtilityCatalog.fromMap(
        jsonDecode(await _bundledList()) as Map<String, dynamic>,
      );
      return bundled.bundled(friendlyMessage(e));
    }
  }

  // Upload carries a request ID the server deduplicates on, so a retry after
  // an empty reply cannot create a second record. That makes the retrying
  // variant safe for it.

  @override
  Future<ExtractedBill> extract({
    required UtilityType type,
    required String ocrText,
  }) async {
    final data = await _api.postIdempotent('/utilities/bills/extract', {
      'utilityType': type.wire,
      'ocrText': ocrText,
    });
    final e = data['extracted'];
    return e is Map<String, dynamic>
        ? ExtractedBill.fromMap(e)
        : const ExtractedBill();
  }

  @override
  Future<UtilityVerification> submitBill({
    required UtilityType type,
    required String providerId,
    required String account,
    required String requestId,
    required String consentVersion,
    required double consumption,
    required DateTime periodStart,
    required DateTime periodEnd,
    String? billFileId,
    String ocrText = '',
    double? previousReading,
    double? currentReading,
  }) async => _verification(
    await _api.postIdempotent('/utilities/bills/upload', {
      'utilityType': type.wire,
      'providerId': providerId,
      'account': UtilityProvider.normalize(account),
      'requestId': requestId,
      'consent': true,
      'consentVersion': consentVersion,
      'billFileId': ?billFileId,
      'ocrText': ocrText,
      'values': {
        'consumptionValue': consumption,
        'consumptionUnit': type.unit,
        'periodStart': isoDay(periodStart),
        'periodEnd': isoDay(periodEnd),
        'previousReading': ?previousReading,
        'currentReading': ?currentReading,
      },
    }),
  );

  @override
  Future<List<UtilityReading>> history({UtilityType? type}) async {
    final data = await _api.postIdempotent('/utilities/consumption/history', {
      if (type != null) 'utilityType': type.wire,
    });
    final rows = data['readings'];
    if (rows is! List) return const [];
    return [
      for (final r in rows.whereType<Map<String, dynamic>>())
        UtilityReading.fromMap(r),
    ];
  }

  @override
  Future<int> deleteAll() async {
    final data = await _api.post('/utilities/delete');
    final n = data['removed'];
    return n is num ? n.round() : 0;
  }

  UtilityVerification _verification(Map<String, dynamic> data) {
    final v = data['verification'];
    if (v is! Map<String, dynamic>) {
      throw const ApiFailure('bad_response', 'Unexpected server response.');
    }
    return UtilityVerification.fromMap(v);
  }
}

final utilityServiceProvider = Provider<UtilityService>(
  (ref) => ApiUtilityService(ref.watch(apiProvider)),
);

/// Providers, regions and the consent text, from the server.
///
/// `retry: null`: show the error card straight away when offline rather than
/// spinning while Riverpod backs off.
final utilityCatalogProvider = FutureProvider<UtilityCatalog>(
  (ref) => ref.watch(utilityServiceProvider).catalog(),
  retry: (_, _) => null,
);

/// The member's imported bills, newest period first. Re-read each time it is
/// shown, because imports and footprint saves both change it.
final utilityHistoryProvider = FutureProvider.autoDispose<List<UtilityReading>>(
  (ref) {
    if (ref.watch(currentUserIdProvider) == null) {
      return const <UtilityReading>[];
    }
    return ref.watch(utilityServiceProvider).history();
  },
  retry: (_, _) => null,
);

/// A fresh request ID. The server treats a repeated ID as the same request.
String newRequestId() {
  final r = Random.secure();
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return 'u${DateTime.now().millisecondsSinceEpoch}_${List.generate(12, (_) => chars[r.nextInt(chars.length)]).join()}';
}

/// Uploads a bill file the user picked or photographed, private to them.
///
/// Photos are downscaled the same way the existing bill screen does it, and
/// read on the phone for suggestions. PDFs are uploaded as they are; nothing
/// is read from them on the phone, so the user types the figures.
class BillUploader {
  BillUploader(this._ref);

  final Ref _ref;

  static bool isPdf(String path) => path.toLowerCase().endsWith('.pdf');

  /// Returns the stored file ID and any OCR text.
  Future<({String fileId, String ocrText})> upload(String path) async {
    final userId = _ref.read(currentUserIdProvider);
    if (userId == null) {
      throw const ApiFailure('not_signed_in', 'Please sign in again.');
    }

    if (isPdf(path)) {
      final file = File(path);
      if (!await file.exists()) {
        throw const FormatException('That file is no longer available.');
      }
      if (await file.length() > 12 * 1024 * 1024) {
        throw const FormatException(
          'That file is too large. Keep bills under 12 MB.',
        );
      }
      final created = await _ref
          .read(storageProvider)
          .createFile(
            bucketId: Buckets.billDocs,
            fileId: ID.unique(),
            file: InputFile.fromPath(
              path: path,
              filename: 'utility_${DateTime.now().millisecondsSinceEpoch}.pdf',
              contentType: 'application/pdf',
            ),
            permissions: [Permission.read(Role.user(userId))],
          );
      return (fileId: created.$id, ocrText: '');
    }

    final ocrText = await _ref.read(visionProvider).readText(path);
    final uploaded = await _ref
        .read(mediaServiceProvider)
        .processAndUpload(
          path: path,
          userId: userId,
          bucketId: Buckets.billDocs,
          prefix: 'utility',
          maxEdge: 2000,
        );
    return (fileId: uploaded.fileId, ocrText: ocrText);
  }
}

final billUploaderProvider = Provider<BillUploader>((ref) => BillUploader(ref));
