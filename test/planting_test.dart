import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dhara/core/services/api.dart';
import 'package:dhara/data/models/planting_request.dart';
import 'package:dhara/state/auth_controller.dart';
import 'package:dhara/state/planting_controller.dart';
import 'package:dhara/ui/screens/trees/planting_detail_screen.dart';

// Planting requests: the model, the form rules, the controller and the one
// screen whose buttons depend on the request's status.

Map<String, dynamic> _wire(
  String id,
  String status, {
  Map<String, dynamic> extra = const {},
}) => {
  'id': id,
  'status': status,
  'createdAt': '2026-11-27T10:00:00.000Z',
  'addressLabel': 'Indiranagar',
  'note': 'Near the lake',
  ...extra,
};

const _reply = {
  'siteAddress': 'Cubbon Park bandstand',
  'siteLat': 12.976,
  'siteLng': 77.592,
  'meetingAt': '2026-12-05T04:00:00.000Z',
  'meetingPoint': 'Main gate',
  'replyNotes': 'Bring water',
};

/// The server function, answering from a list the test controls.
class _Api extends Api {
  _Api(super.ref, this.rows);

  List<Map<String, dynamic>> rows;
  Object? failWith;
  final calls = <String>[];

  Map<String, dynamic> _find(String id) =>
      rows.firstWhere((r) => r['id'] == id);

  @override
  Future<Map<String, dynamic>> myPlantingRequests() async {
    calls.add('mine');
    return {'requests': rows};
  }

  @override
  Future<Map<String, dynamic>> requestPlanting({
    double? lat,
    double? lng,
    String addressLabel = '',
    String note = '',
    DateTime? preferredFrom,
    DateTime? preferredTo,
  }) async {
    calls.add('request');
    final e = failWith;
    if (e != null) throw e;
    return {'request': _wire('new1', 'open', extra: {'addressLabel': addressLabel})};
  }

  @override
  Future<Map<String, dynamic>> respondToPlanting({
    required String id,
    required bool accept,
  }) async {
    calls.add(accept ? 'accept' : 'decline');
    final e = failWith;
    if (e != null) throw e;
    final row = {
      ..._find(id),
      'status': accept ? 'confirmed' : 'declined',
      'userResponse': accept ? 'accepted' : 'declined',
    };
    return {'request': row};
  }

  @override
  Future<Map<String, dynamic>> cancelPlanting(String id) async {
    calls.add('cancel');
    return {'request': {..._find(id), 'status': 'cancelled'}};
  }
}

ProviderContainer _container(List<Map<String, dynamic>> rows) {
  final c = ProviderContainer(
    overrides: [
      currentUserIdProvider.overrideWithValue('u1'),
      apiProvider.overrideWith((ref) => _Api(ref, rows)),
    ],
  );
  addTearDown(c.dispose);
  c.read(apiProvider);
  return c;
}

_Api _apiOf(ProviderContainer c) => c.read(apiProvider) as _Api;

void main() {
  group('PlantingRequest', () {
    test('reads what the server sends', () {
      final r = PlantingRequest.fromMap(_wire('r1', 'scheduled', extra: _reply));
      expect(r.id, 'r1');
      expect(r.status, PlantingStatus.scheduled);
      expect(r.addressLabel, 'Indiranagar');
      expect(r.siteAddress, 'Cubbon Park bandstand');
      expect(r.siteLat, 12.976);
      expect(r.meetingPoint, 'Main gate');
      expect(r.meetingAt, isNotNull);
      expect(r.hasReply, isTrue);
      expect(r.hasSitePin, isTrue);
    });

    test('copes with a request the NGO has not answered', () {
      final r = PlantingRequest.fromMap(_wire('r1', 'open'));
      expect(r.hasReply, isFalse);
      expect(r.hasSitePin, isFalse);
      expect(r.meetingAt, isNull);
    });

    test('an unknown status reads as open rather than crashing', () {
      expect(PlantingRequest.fromMap(_wire('r1', 'mystery')).status, PlantingStatus.open);
    });

    test('only a scheduled request needs an answer', () {
      for (final s in PlantingStatus.values) {
        final r = PlantingRequest.fromMap(_wire('r', s.wire));
        expect(r.needsAnswer, s == PlantingStatus.scheduled, reason: s.wire);
      }
    });

    test('cancel is offered exactly where the server allows it', () {
      const allowed = {
        PlantingStatus.open,
        PlantingStatus.scheduled,
        PlantingStatus.declined,
      };
      for (final s in PlantingStatus.values) {
        final r = PlantingRequest.fromMap(_wire('r', s.wire));
        expect(r.canCancel, allowed.contains(s), reason: s.wire);
      }
    });

    test('finished requests are not active', () {
      expect(PlantingRequest.fromMap(_wire('r', 'completed')).isActive, isFalse);
      expect(PlantingRequest.fromMap(_wire('r', 'cancelled')).isActive, isFalse);
      expect(PlantingRequest.fromMap(_wire('r', 'confirmed')).isActive, isTrue);
    });
  });

  group('planningProblem', () {
    final now = DateTime(2026, 11, 27, 10);

    test('needs a pin or an address', () {
      expect(planningProblem(lat: null, lng: null, address: '', now: now), isNotNull);
      expect(planningProblem(lat: null, lng: null, address: 'ab', now: now), isNotNull);
      expect(planningProblem(lat: null, lng: null, address: 'Indiranagar', now: now), isNull);
      expect(planningProblem(lat: 12.9, lng: 77.5, address: '', now: now), isNull);
    });

    test('a half pin does not count', () {
      expect(planningProblem(lat: 12.9, lng: null, address: '', now: now), isNotNull);
    });

    test('dates must be in order, current and a sensible length', () {
      const addr = 'Indiranagar';
      expect(
        planningProblem(lat: null, lng: null, address: addr, now: now,
            from: DateTime(2026, 12, 10), to: DateTime(2026, 12, 5)),
        isNotNull,
      );
      expect(
        planningProblem(lat: null, lng: null, address: addr, now: now,
            to: DateTime(2026, 11, 20)),
        isNotNull,
      );
      expect(
        planningProblem(lat: null, lng: null, address: addr, now: now,
            from: DateTime(2026, 12, 1), to: DateTime(2027, 9, 1)),
        isNotNull,
      );
      expect(
        planningProblem(lat: null, lng: null, address: addr, now: now,
            from: DateTime(2026, 11, 27), to: DateTime(2026, 12, 10)),
        isNull,
      );
    });
  });

  group('PlantingController', () {
    test('loads the member\'s requests', () async {
      final c = _container([_wire('r1', 'open'), _wire('r2', 'scheduled', extra: _reply)]);
      final list = await c.read(plantingControllerProvider.future);
      expect(list.map((r) => r.id), ['r1', 'r2']);
      expect(c.read(plantingNeedingAnswerProvider), 1);
    });

    test('a new request goes to the top', () async {
      final c = _container([_wire('r1', 'open')]);
      await c.read(plantingControllerProvider.future);
      await c.read(plantingControllerProvider.notifier).create(addressLabel: 'Koramangala');
      final list = c.read(plantingControllerProvider).value!;
      expect(list.map((r) => r.id), ['new1', 'r1']);
      expect(list.first.addressLabel, 'Koramangala');
    });

    test('accepting stores what the server says, not a guess', () async {
      final c = _container([_wire('r1', 'scheduled', extra: _reply)]);
      await c.read(plantingControllerProvider.future);
      final updated = await c
          .read(plantingControllerProvider.notifier)
          .respond('r1', accept: true);
      expect(updated.status, PlantingStatus.confirmed);
      expect(c.read(plantingControllerProvider).value!.single.status, PlantingStatus.confirmed);
      expect(c.read(plantingNeedingAnswerProvider), 0);
    });

    test('declining and cancelling update the list in place', () async {
      final c = _container([
        _wire('r1', 'scheduled', extra: _reply),
        _wire('r2', 'open'),
      ]);
      await c.read(plantingControllerProvider.future);
      final n = c.read(plantingControllerProvider.notifier);

      await n.respond('r1', accept: false);
      await n.cancel('r2');

      final byId = {for (final r in c.read(plantingControllerProvider).value!) r.id: r};
      expect(byId['r1']!.status, PlantingStatus.declined);
      expect(byId['r2']!.status, PlantingStatus.cancelled);
    });

    test('a refused answer leaves the list as it was and rethrows', () async {
      final c = _container([_wire('r1', 'scheduled', extra: _reply)]);
      await c.read(plantingControllerProvider.future);
      _apiOf(c).failWith = const ApiFailure('invalid_state', 'Not possible right now.');

      await expectLater(
        c.read(plantingControllerProvider.notifier).respond('r1', accept: true),
        throwsA(isA<ApiFailure>()),
      );
      expect(c.read(plantingControllerProvider).value!.single.status, PlantingStatus.scheduled);
    });

    test('signed out there is nothing to load', () async {
      final c = ProviderContainer(
        overrides: [currentUserIdProvider.overrideWithValue(null)],
      );
      addTearDown(c.dispose);
      expect(await c.read(plantingControllerProvider.future), isEmpty);
    });
  });

  group('PlantingDetailScreen', () {
    Future<ProviderContainer> show(
      WidgetTester tester,
      Map<String, dynamic> row,
    ) async {
      tester.view.physicalSize = const Size(900, 2400);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);

      final c = _container([row]);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            home: PlantingDetailScreen(requestId: row['id'] as String),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return c;
    }

    testWidgets('a scheduled request shows the plan and both answers', (tester) async {
      await show(tester, _wire('r1', 'scheduled', extra: _reply));
      expect(find.text('Cubbon Park bandstand'), findsOneWidget);
      expect(find.text('Main gate'), findsOneWidget);
      expect(find.text("I'll be there"), findsOneWidget);
      expect(find.text("I can't make this time"), findsOneWidget);
      expect(find.text('Cancel this request'), findsOneWidget);
      expect(find.text('Open the site in maps'), findsOneWidget);
    });

    testWidgets('an unanswered request offers cancel but no answer', (tester) async {
      await show(tester, _wire('r1', 'open'));
      expect(find.text("I'll be there"), findsNothing);
      expect(find.text("I can't make this time"), findsNothing);
      expect(find.text('Cancel this request'), findsOneWidget);
      expect(find.text('Your planting plan'), findsNothing);
    });

    testWidgets('a confirmed request cannot be cancelled from the app', (tester) async {
      await show(tester, _wire('r1', 'confirmed', extra: _reply));
      expect(find.text("I'll be there"), findsNothing);
      expect(find.text('Cancel this request'), findsNothing);
      expect(find.textContaining('The NGO is expecting you'), findsOneWidget);
    });

    testWidgets('a declined request waits for the NGO', (tester) async {
      await show(tester, _wire('r1', 'declined', extra: _reply));
      expect(find.text("I'll be there"), findsNothing);
      expect(find.textContaining('suggest another one'), findsOneWidget);
      expect(find.text('Cancel this request'), findsOneWidget);
    });

    testWidgets('a completed request points to registering the tree', (tester) async {
      await show(tester, _wire('r1', 'completed', extra: _reply));
      expect(find.text('Register your tree'), findsOneWidget);
      expect(find.text('Cancel this request'), findsNothing);
    });

    testWidgets('a cancelled request has no actions', (tester) async {
      await show(tester, _wire('r1', 'cancelled'));
      expect(find.byType(FilledButton), findsNothing);
      expect(find.text('Cancel this request'), findsNothing);
    });

    testWidgets('tapping "I\'ll be there" confirms and the screen follows', (tester) async {
      final c = await show(tester, _wire('r1', 'scheduled', extra: _reply));
      await tester.tap(find.text("I'll be there"));
      await tester.pumpAndSettle();

      expect(_apiOf(c).calls, contains('accept'));
      expect(find.text("I'll be there"), findsNothing);
      expect(find.text('Confirmed'), findsOneWidget);
    });

    testWidgets('declining asks first, then updates', (tester) async {
      final c = await show(tester, _wire('r1', 'scheduled', extra: _reply));
      await tester.tap(find.text("I can't make this time"));
      await tester.pumpAndSettle();
      expect(find.text('Cannot make this time?'), findsOneWidget);
      expect(_apiOf(c).calls, isNot(contains('decline')));

      await tester.tap(find.text('Decline this time'));
      await tester.pumpAndSettle();
      expect(_apiOf(c).calls, contains('decline'));
      expect(find.text('Waiting for a new time'), findsOneWidget);
    });

    testWidgets('a request that is not in the list says so', (tester) async {
      tester.view.physicalSize = const Size(900, 2400);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);

      final c = _container([_wire('r1', 'open')]);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: const MaterialApp(home: PlantingDetailScreen(requestId: 'gone')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Request not found'), findsOneWidget);
    });
  });
}
