// This Appwrite server still routes documents through /collections/:id/documents
// — the newer /tables/:id/rows endpoints return 404 — so the deprecated
// Databases API is the correct one to call here. Confining every read to this
// file keeps that single compromise in one place instead of spreading
// suppressions across the controllers.
// ignore_for_file: deprecated_member_use

import 'package:appwrite/appwrite.dart';
import 'package:appwrite/models.dart' as models;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/env.dart';
import '../core/services/appwrite.dart';
import 'models/footprint.dart';
import 'models/item.dart';
import 'models/profile.dart';
import 'models/reward.dart';
import 'models/tree.dart';

/// Read side of the app.
///
/// Every write that mints, moves or spends credits goes through the `api`
/// Appwrite Function instead: those rules must not be enforceable from a
/// client. Reads are safe to do directly because each privileged collection is
/// `documentSecurity: true` and the function grants per-document read access to
/// the owning user, so a query can only ever return rows the caller may see.
class Repository {
  const Repository(this._db);

  final Databases _db;

  Future<List<models.Document>> _list(
    String collectionId,
    List<String> queries,
  ) async {
    final res = await _db.listDocuments(
      databaseId: Env.databaseId,
      collectionId: collectionId,
      queries: queries,
    );
    return res.documents;
  }

  // --- Trees ---------------------------------------------------------------

  Future<List<Tree>> myTrees(String userId, {int limit = 100}) async {
    final docs = await _list(Col.trees, [
      Query.equal('ownerId', userId),
      Query.orderDesc('plantedAt'),
      Query.limit(limit),
    ]);
    return docs.map((d) => Tree.fromMap(d.data)).toList();
  }

  Future<Tree?> treeById(String treeId) async {
    try {
      final doc = await _db.getDocument(
        databaseId: Env.databaseId,
        collectionId: Col.trees,
        documentId: treeId,
      );
      return Tree.fromMap(doc.data);
    } on AppwriteException catch (e) {
      if (e.code == 404) return null;
      rethrow;
    }
  }

  Future<List<TreeVerification>> verifications(
    String treeId, {
    int limit = 24,
  }) async {
    final docs = await _list(Col.treeVerifications, [
      Query.equal('treeId', treeId),
      Query.orderDesc('verifiedAt'),
      Query.limit(limit),
    ]);
    return docs.map((d) => TreeVerification.fromMap(d.data)).toList();
  }

  Future<List<Species>> species() async {
    final docs = await _list(Col.species, [
      Query.equal('isActive', true),
      Query.orderAsc('sortOrder'),
      Query.limit(100),
    ]);
    return docs.map((d) => Species.fromMap(d.data)).toList();
  }

  // --- Custody chain -------------------------------------------------------

  /// Items currently in the caller's hands, newest movement first.
  Future<List<TrackedItem>> myItems(String userId, {int limit = 100}) async {
    final docs = await _list(Col.items, [
      Query.equal('holderId', userId),
      Query.orderDesc(r'$updatedAt'),
      Query.limit(limit),
    ]);
    return docs.map((d) => TrackedItem.fromMap(d.data)).toList();
  }

  Future<List<CustodyEvent>> custodyHistory(
    String itemId, {
    int limit = 50,
  }) async {
    final docs = await _list(Col.custodyEvents, [
      Query.equal('itemId', itemId),
      Query.orderDesc('occurredAt'),
      Query.limit(limit),
    ]);
    return docs.map((d) => CustodyEvent.fromMap(d.data)).toList();
  }

  // --- Credits and rewards -------------------------------------------------

  Future<List<Reward>> rewards() async {
    final docs = await _list(Col.rewards, [
      Query.equal('isActive', true),
      Query.orderAsc('sortOrder'),
      Query.limit(100),
    ]);
    return docs.map((d) => Reward.fromMap(d.data)).toList();
  }

  Future<List<Redemption>> myRedemptions(String userId, {int limit = 50}) async {
    final docs = await _list(Col.redemptions, [
      Query.equal('userId', userId),
      Query.orderDesc('requestedAt'),
      Query.limit(limit),
    ]);
    return docs.map((d) => Redemption.fromMap(d.data)).toList();
  }

  Future<List<CreditEntry>> ledger(String userId, {int limit = 60}) async {
    final docs = await _list(Col.creditLedger, [
      Query.equal('userId', userId),
      Query.orderDesc('occurredAt'),
      Query.limit(limit),
    ]);
    return docs.map((d) => CreditEntry.fromMap(d.data)).toList();
  }

  /// The bill account backing electricity redemptions, if one is on file.
  Future<Map<String, dynamic>?> primaryElectricityAccount(String userId) async {
    final docs = await _list(Col.electricityAccounts, [
      Query.equal('userId', userId),
      Query.orderDesc('submittedAt'),
      Query.limit(1),
    ]);
    return docs.isEmpty ? null : docs.first.data;
  }

  // --- Carbon footprint ----------------------------------------------------

  /// The caller's saved months, newest first. Each row is readable only by its
  /// owner, so the query can only ever return the caller's own.
  Future<List<FootprintEntry>> myFootprints(String userId, {int limit = 24}) async {
    final docs = await _list(Col.footprints, [
      Query.equal('userId', userId),
      Query.orderDesc('monthKey'),
      Query.limit(limit),
    ]);
    return docs.map((d) => FootprintEntry.fromMap(d.data)).toList();
  }

  // --- Gamification --------------------------------------------------------

  Future<List<LeaderboardEntry>> leaderboard({
    String period = 'all_time',
    int limit = 100,
  }) async {
    final docs = await _list(Col.leaderboard, [
      Query.equal('period', period),
      Query.orderAsc('rank'),
      Query.limit(limit),
    ]);
    return docs.map((d) => LeaderboardEntry.fromMap(d.data)).toList();
  }

  /// The badge catalog joined with what the caller has already earned, so the
  /// UI can show locked badges with live progress rather than hiding them.
  Future<List<BadgeItem>> badges(String userId) async {
    final results = await Future.wait([
      _list(Col.badges, [
        Query.equal('isActive', true),
        Query.orderAsc('sortOrder'),
        Query.limit(100),
      ]),
      _list(Col.userBadges, [
        Query.equal('userId', userId),
        Query.limit(100),
      ]),
    ]);

    final earnedAt = <String, DateTime>{};
    for (final doc in results[1]) {
      final code = doc.data['badgeCode'];
      final when = doc.data['earnedAt'];
      if (code is String && when is String) {
        final parsed = DateTime.tryParse(when);
        if (parsed != null) earnedAt[code] = parsed;
      }
    }

    return results[0]
        .map((d) => BadgeItem.fromMap(d.data, earnedAt: earnedAt[d.data['code']]))
        .toList();
  }

  // --- Profile -------------------------------------------------------------

  Future<Profile?> profile(String userId) async {
    try {
      final doc = await _db.getDocument(
        databaseId: Env.databaseId,
        collectionId: Col.profiles,
        documentId: userId,
      );
      return Profile.fromMap(doc.data);
    } on AppwriteException catch (e) {
      if (e.code == 404) return null;
      rethrow;
    }
  }
}

final repositoryProvider = Provider<Repository>(
  (ref) => Repository(ref.watch(databasesProvider)),
);
