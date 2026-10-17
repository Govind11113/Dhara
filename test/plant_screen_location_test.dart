import 'dart:async';

import 'package:dhara/core/services/location.dart';
import 'package:dhara/data/models/tree.dart';
import 'package:dhara/state/trees_controller.dart';
import 'package:dhara/ui/screens/trees/plant_tree_screen.dart';
import 'package:dhara/ui/widgets/tree_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

import 'support/fake_location_backend.dart';

class _NoTrees extends TreesController {
  @override
  Future<List<Tree>> build() async => const [];
}

const _neem = Species(
  code: 'neem',
  name: 'Neem',
  creditsPerVerification: 12,
  co2PerYearGrams: 21000,
);

final finding = find.text('Finding you on the map\u2026');
final stillLooking = find.textContaining('Still looking for you');
final mapTryAgain = find.descendant(of: find.byType(TreeMap), matching: find.text('Try again'));


/// Unmounts the screen and lets any delayed animation timers fire.
///
/// The screen's entrance animations schedule zero-length timers on mount; one
/// still pending when a test ends fails it, whatever the test was checking.
Future<void> finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 5));
}

Future<void> openLocationStep(WidgetTester tester, FakeLocationBackend phone) async {
  tester.view.physicalSize = const Size(1200, 3200);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        locationServiceProvider.overrideWithValue(LocationService(backend: phone)),
        speciesProvider.overrideWith((ref) async => [_neem]),
        treesControllerProvider.overrideWith(_NoTrees.new),
      ],
      child: const MaterialApp(home: PlantTreeScreen()),
    ),
  );
  await tester.pump(const Duration(seconds: 2));

  await tester.tap(find.text('Neem'));
  await tester.pump();
  await tester.tap(find.text('Next'));
  // Not pumpAndSettle: the spinner animates forever by design.
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  late FakeLocationBackend phone;

  setUp(() => phone = FakeLocationBackend());

  // The reported bug, scenario one: the phone has location switched off. The
  // card below said so, and the map above kept saying "Finding you" forever.
  testWidgets('location off: the map explains it and offers a retry', (tester) async {
    phone.serviceEnabled = false;
    await openLocationStep(tester, phone);
    await tester.pump(const Duration(seconds: 1));

    expect(find.text('Turn on location services to continue.'), findsWidgets);
    expect(finding, findsNothing);
    expect(mapTryAgain, findsOneWidget);

    // Switch location on and press the map's own Try again.
    phone.serviceEnabled = true;
    phone.permission = LocationPermission.whileInUse;
    await tester.tap(mapTryAgain);
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Turn on location services to continue.'), findsNothing);
    expect(find.byType(FlutterMap), findsOneWidget);
    expect(find.text('Location locked'), findsOneWidget);
    await finish(tester);
  });

  // Scenario two: the phone never produces a position. It used to spin for
  // good; now it owns up to it and offers a way out.
  testWidgets('no position ever arrives: it says so after 15 seconds', (tester) async {
    phone.permission = LocationPermission.whileInUse;
    final never = Completer<Position>();
    phone.readings = [() => never.future];

    await openLocationStep(tester, phone);
    expect(finding, findsOneWidget);
    expect(mapTryAgain, findsNothing);

    await tester.pump(const Duration(seconds: 16));
    expect(stillLooking, findsOneWidget);
    expect(mapTryAgain, findsOneWidget);
    await finish(tester);
  });

  // Scenario three: a brand-new install. Permission is undecided, so the live
  // stream and the precise fix both need the dialog.
  testWidgets('first run: one permission dialog, then a locked position', (tester) async {
    phone.dialogTime = const Duration(milliseconds: 150);
    await openLocationStep(tester, phone);
    await tester.pump(const Duration(milliseconds: 600));

    expect(phone.requestCalls, 1);
    expect(find.text('Location locked'), findsOneWidget);
    expect(find.byType(FlutterMap), findsOneWidget);
    expect(finding, findsNothing);
    await finish(tester);
  });

  testWidgets('a refused permission is explained on the map too', (tester) async {
    phone.answer = LocationPermission.denied;
    await openLocationStep(tester, phone);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.textContaining('needs your location'), findsWidgets);
    expect(finding, findsNothing);
    expect(mapTryAgain, findsOneWidget);
    await finish(tester);
  });

  testWidgets('a cached position puts the map up at once, marked approximate', (tester) async {
    phone.permission = LocationPermission.whileInUse;
    phone.cached = pos(lat: 12.97, lng: 77.59, accuracy: 60);
    final never = Completer<Position>();
    phone.readings = [() => never.future];

    await openLocationStep(tester, phone);
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byType(FlutterMap), findsOneWidget);
    expect(find.textContaining('Approximate'), findsOneWidget);
    expect(finding, findsNothing);
    await finish(tester);
  });

  // The cached position is a stand-in for the map only. It must never unlock
  // the "Take the photo" button, which proves presence at the tree.
  testWidgets('a cached position never enables the photo button', (tester) async {
    phone.permission = LocationPermission.whileInUse;
    phone.cached = pos(accuracy: 3);
    final never = Completer<Position>();
    phone.readings = [() => never.future];

    await openLocationStep(tester, phone);
    await tester.pump(const Duration(milliseconds: 100));

    final button = tester.widget<FilledButton>(find.ancestor(
      of: find.text('Take the photo'),
      matching: find.byType(FilledButton),
    ));
    expect(button.onPressed, isNull);
    await finish(tester);
  });

  testWidgets('a good fix enables the photo button', (tester) async {
    phone.permission = LocationPermission.whileInUse;
    await openLocationStep(tester, phone);
    await tester.pump(const Duration(milliseconds: 300));

    final button = tester.widget<FilledButton>(find.ancestor(
      of: find.text('Take the photo'),
      matching: find.byType(FilledButton),
    ));
    expect(button.onPressed, isNotNull);
    await finish(tester);
  });

  testWidgets('leaving the step stops the position stream', (tester) async {
    phone.permission = LocationPermission.whileInUse;
    await openLocationStep(tester, phone);
    await tester.pump(const Duration(milliseconds: 300));
    expect(phone.stream.hasListener, isTrue);

    await tester.tap(find.text('Back'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(phone.stream.hasListener, isFalse);
    await finish(tester);
  });

  testWidgets('the species list shows what each tree absorbs', (tester) async {
    tester.view.physicalSize = const Size(1200, 3200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          locationServiceProvider.overrideWithValue(LocationService(backend: phone)),
          speciesProvider.overrideWith((ref) async => [_neem]),
          treesControllerProvider.overrideWith(_NoTrees.new),
        ],
        child: const MaterialApp(home: PlantTreeScreen()),
      ),
    );
    await tester.pump(const Duration(seconds: 2));
    expect(find.textContaining('21 kg CO\u2082 a year when mature'), findsOneWidget);
    await finish(tester);
  });
}
