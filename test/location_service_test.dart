import 'dart:async';

import 'package:dhara/core/services/location.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

import 'support/fake_location_backend.dart';

void main() {
  late FakeLocationBackend phone;
  late LocationService service;

  setUp(() {
    phone = FakeLocationBackend();
    service = LocationService(backend: phone);
  });

  group('permission', () {
    // The reported bug. A first run has permission undecided; the plant screen
    // starts the live map stream and the precise fix in the same frame.
    test('a stream and a fix started together ask the OS only once', () async {
      final firstPoint = service.watch().first;
      final fix = service.bestFix(
        targetAccuracyM: 15,
        sampleGap: Duration.zero,
      );

      // Let both reach the permission step before the stream gets a point.
      await Future<void>.delayed(const Duration(milliseconds: 100));
      phone.stream.add(pos(accuracy: 12));

      expect((await fix).lat, closeTo(12.9716, 1e-9));
      expect((await firstPoint).accuracyM, 12);
      expect(phone.requestCalls, 1);
    });

    test('many callers at once share one request', () async {
      await Future.wait([for (var i = 0; i < 6; i++) service.ensureReady()]);
      expect(phone.requestCalls, 1);
    });

    test('everyone waiting hears the same refusal', () async {
      phone.answer = LocationPermission.denied;
      final results = await Future.wait([
        for (var i = 0; i < 3; i++)
          service.ensureReady().then<Object>((_) => 'ok').catchError((Object e) => e),
      ]);

      for (final r in results) {
        expect(r, isA<LocationFailure>());
        expect((r as LocationFailure).problem, LocationProblem.permissionDenied);
      }
      expect(phone.requestCalls, 1);
    });

    // The shared request must be forgotten once it ends, or a person who
    // refused once could never be asked again.
    test('a refusal does not stick: the next attempt asks again', () async {
      phone.answer = LocationPermission.denied;
      await expectLater(service.ensureReady(), throwsA(isA<LocationFailure>()));

      phone.answer = LocationPermission.whileInUse;
      await service.ensureReady();
      expect(phone.requestCalls, 2);
    });

    test('a request made while another part of the app has the dialog open waits', () async {
      unawaited(phone.openDialogElsewhere());
      await Future<void>.delayed(const Duration(milliseconds: 5));

      // The plugin would throw here. The service waits for the answer instead.
      await service.ensureReady();
      expect(phone.permission, LocationPermission.whileInUse);
    });

    test('already granted: no dialog at all', () async {
      phone.permission = LocationPermission.whileInUse;
      await service.ensureReady();
      expect(phone.requestCalls, 0);
    });

    test('location switched off', () async {
      phone.serviceEnabled = false;
      await expectLater(
        service.ensureReady(),
        throwsA(
          isA<LocationFailure>().having((e) => e.problem, 'problem', LocationProblem.serviceDisabled),
        ),
      );
      expect(phone.requestCalls, 0);
    });

    test('blocked for good is reported with a way forward', () async {
      phone.permission = LocationPermission.deniedForever;
      await expectLater(
        service.ensureReady(),
        throwsA(
          isA<LocationFailure>()
              .having((e) => e.problem, 'problem', LocationProblem.permissionDeniedForever)
              .having((e) => e.message, 'message', contains('system settings')),
        ),
      );
      expect(phone.requestCalls, 0);
    });
  });

  group('bestFix', () {
    setUp(() => phone.permission = LocationPermission.whileInUse);

    test('stops at the first reading that is accurate enough', () async {
      phone.readings = [() => pos(accuracy: 6), () => pos(accuracy: 3)];
      final fix = await service.bestFix(sampleGap: Duration.zero);
      expect(fix.accuracyM, 6);
      expect(fix.samples, 1);
      expect(phone.currentCalls, 1);
    });

    test('keeps the most accurate of several readings', () async {
      phone.readings = [
        () => pos(accuracy: 60, lat: 1),
        () => pos(accuracy: 22, lat: 2),
        () => pos(accuracy: 35, lat: 3),
        () => pos(accuracy: 14, lat: 4),
      ];
      final fix = await service.bestFix(sampleGap: Duration.zero);
      expect(fix.accuracyM, 14);
      expect(fix.lat, 4);
      expect(fix.samples, 4);
    });

    test('reports progress with the best accuracy so far', () async {
      phone.readings = [() => pos(accuracy: 40), () => pos(accuracy: 50), () => pos(accuracy: 9)];
      final seen = <String>[];
      await service.bestFix(
        sampleGap: Duration.zero,
        onProgress: (acc, n) => seen.add('$n:${acc.round()}'),
      );
      expect(seen, ['1:40', '2:40', '3:9']);
    });

    test('a spoofed location is refused and the message mentions emulators', () async {
      phone.readings = [() => pos(mocked: true)];
      await expectLater(
        service.bestFix(sampleGap: Duration.zero),
        throwsA(
          isA<LocationFailure>()
              .having((e) => e.problem, 'problem', LocationProblem.mocked)
              .having((e) => e.message, 'message', contains('emulator')),
        ),
      );
    });

    test('a fix that never arrives ends in a timeout, not a hang', () async {
      phone.readings = [() => throw TimeoutException('no fix')];
      await expectLater(
        service.bestFix(sampleGap: Duration.zero),
        throwsA(
          isA<LocationFailure>().having((e) => e.problem, 'problem', LocationProblem.timeout),
        ),
      );
    });

    test('a timeout after some readings still returns the best so far', () async {
      phone.readings = [() => pos(accuracy: 30), () => throw TimeoutException('later')];
      final fix = await service.bestFix(sampleGap: Duration.zero);
      expect(fix.accuracyM, 30);
    });

    test('an unreadable first reading is an error the person can act on', () async {
      phone.readings = [() => throw StateError('hardware fault')];
      await expectLater(
        service.bestFix(sampleGap: Duration.zero),
        throwsA(
          isA<LocationFailure>().having((e) => e.problem, 'problem', LocationProblem.unknown),
        ),
      );
    });

    test('carries the whole reading through', () async {
      final fix = await service.bestFix(sampleGap: Duration.zero);
      expect(fix.lat, 12.9716);
      expect(fix.lng, 77.5946);
      expect(fix.isMocked, isFalse);
      expect(fix.capturedAt, DateTime.utc(2026, 10, 17, 12));
    });
  });

  group('lastKnown', () {
    test('returns the cached position when access is already granted', () async {
      phone.permission = LocationPermission.whileInUse;
      phone.cached = pos(lat: 19.07, lng: 72.87);
      final fix = await service.lastKnown();
      expect(fix?.lat, 19.07);
    });

    // The map uses this to avoid an empty spinner, so it must never be the thing
    // that throws a permission dialog.
    test('never asks for permission', () async {
      phone.cached = pos();
      expect(await service.lastKnown(), isNull);
      expect(phone.requestCalls, 0);
    });

    test('nothing cached, location off, or a platform error all read as null', () async {
      phone.permission = LocationPermission.whileInUse;
      expect(await service.lastKnown(), isNull);

      phone.cached = pos();
      phone.serviceEnabled = false;
      expect(await service.lastKnown(), isNull);
    });
  });

  group('passiveFix', () {
    test('is null, and silent, when access has not been granted', () async {
      expect(await service.passiveFix(), isNull);
      expect(phone.requestCalls, 0);
      expect(phone.currentCalls, 0);
    });

    test('prefers the cached position and does not wake the GPS', () async {
      phone.permission = LocationPermission.always;
      phone.cached = pos(lat: 28.6, lng: 77.2);
      final fix = await service.passiveFix();
      expect(fix?.lat, 28.6);
      expect(phone.currentCalls, 0);
    });

    test('otherwise takes one coarse reading', () async {
      phone.permission = LocationPermission.whileInUse;
      final fix = await service.passiveFix();
      expect(fix, isNotNull);
      expect(phone.currentCalls, 1);
      expect(phone.lastCurrentSettings?.accuracy, LocationAccuracy.low);
    });

    test('a failed reading is null, never an exception', () async {
      phone.permission = LocationPermission.whileInUse;
      phone.readings = [() => throw TimeoutException('slow')];
      expect(await service.passiveFix(), isNull);
    });
  });

  group('watch', () {
    test('asks for display-grade accuracy, not navigation grade', () async {
      phone.permission = LocationPermission.whileInUse;
      final sub = service.watch().listen((_) {});
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(phone.lastStreamSettings?.accuracy, LocationAccuracy.high);
      await sub.cancel();
    });

    test('a refused permission surfaces as an error on the stream', () async {
      phone.answer = LocationPermission.denied;
      await expectLater(service.watch().first, throwsA(isA<LocationFailure>()));
    });

    test('maps each point to a fix', () async {
      phone.permission = LocationPermission.whileInUse;
      final next = service.watch().first;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      phone.stream.add(pos(lat: 11, lng: 76, accuracy: 4));
      final fix = await next;
      expect((fix.lat, fix.lng, fix.accuracyM), (11.0, 76.0, 4.0));
    });
  });
}
