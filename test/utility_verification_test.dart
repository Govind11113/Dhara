import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dhara/core/services/api.dart';
import 'package:dhara/core/utils/errors.dart';
import 'package:dhara/data/models/footprint.dart';
import 'package:dhara/data/models/tree.dart';
import 'package:dhara/data/models/utility.dart';
import 'package:dhara/state/auth_controller.dart';
import 'package:dhara/state/footprint_controller.dart';
import 'package:dhara/state/trees_controller.dart';
import 'package:dhara/state/utility_controller.dart';
import 'package:dhara/ui/screens/footprint/footprint_screen.dart';
import 'package:dhara/ui/screens/utility/utility_history_screen.dart';
import 'package:dhara/ui/screens/utility/utility_upload_screen.dart';
import 'package:dhara/ui/screens/utility/utility_verify_screen.dart';

// Mock service for tests only. All account numbers are made up.

Map<String, dynamic> _provider(
  String id,
  String type,
  String name, {
  String pattern = r'^[A-Z0-9-]{6,20}$',
}) => {
  'id': id,
  'utilityType': type,
  'state': 'MH',
  'name': name,
  'accountLabel': type == 'png' ? 'BP number' : 'Consumer number',
  'accountHelp': 'Printed on your bill.',
  'accountPattern': pattern,
  'consumptionUnit': type == 'png' ? 'SCM' : 'kWh',
  'serviceAreas': <String>[],
};

final _catalog = UtilityCatalog.fromMap({
  'regions': [
    {
      'country': 'IN',
      'countryName': 'India',
      'states': [
        {'code': 'MH', 'name': 'Maharashtra'},
      ],
    },
  ],
  'providers': [
    _provider(
      'msedcl',
      'electricity',
      'MSEDCL (Mahavitaran)',
      pattern: r'^[0-9]{12}$',
    ),
    _provider('best_mumbai', 'electricity', 'BEST Mumbai'),
    _provider('mgl', 'png', 'Mahanagar Gas (MGL)'),
    _provider('mngl', 'png', 'Maharashtra Natural Gas (MNGL)'),
  ],
  'consent': {'version': '2026-11-01', 'purpose': 'Footprint'},
});

Map<String, dynamic> _readingMap({
  String id = 'r1',
  String type = 'electricity',
  String status = 'document_review',
  double value = 248,
  String unit = 'kWh',
  String start = '2026-10-01',
  String end = '2026-10-31',
  String? applied,
  String carbon = 'calculated',
}) => {
  'id': id,
  'utilityType': type,
  'providerName': type == 'png'
      ? 'Mahanagar Gas (MGL)'
      : 'MSEDCL (Mahavitaran)',
  'accountMasked': '********9012',
  'status': status,
  'periodStart': start,
  'periodEnd': end,
  'consumptionValue': value,
  'consumptionUnit': unit,
  'billAmount': 1840.0,
  'carbonKg': carbon == 'calculated' ? 180.296 : null,
  'carbonStatus': carbon,
  'appliedMonthKey': applied,
  'fetchedAt': null,
};

UtilityVerification _verification(
  String status, {
  Map<String, dynamic>? reading,
  String? message,
}) => UtilityVerification.fromMap({
  'id': 'v1',
  'utilityType': 'electricity',
  'providerName': 'MSEDCL (Mahavitaran)',
  'accountMasked': '********9012',
  'status': status,
  'message': message,
  'reading': reading,
});

class FakeUtilityService implements UtilityService {
  UtilityVerification submitResult = _verification(
    'document_review',
    reading: _readingMap(status: 'document_review'),
  );
  ExtractedBill extracted = const ExtractedBill();
  Object? catalogError;
  UtilityCatalog? catalogValue;
  Object? historyError;
  List<UtilityReading> readings = const [];
  final calls = <String>[];
  String? lastBillFileId;
  double? lastConsumption;

  @override
  Future<UtilityCatalog> catalog() async {
    final e = catalogError;
    if (e != null) throw e;
    return catalogValue ?? _catalog;
  }

  @override
  Future<ExtractedBill> extract({
    required UtilityType type,
    required String ocrText,
  }) async {
    calls.add('extract');
    return extracted;
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
  }) async {
    calls.add('submit');
    lastBillFileId = billFileId;
    lastConsumption = consumption;
    return submitResult;
  }

  @override
  Future<List<UtilityReading>> history({UtilityType? type}) async {
    final e = historyError;
    if (e != null) throw e;
    return readings;
  }

  @override
  Future<int> deleteAll() async {
    calls.add('delete');
    return readings.length;
  }
}

class FakeUploader implements BillUploader {
  int uploads = 0;

  @override
  Future<({String fileId, String ocrText})> upload(String path) async {
    uploads++;
    return (fileId: 'file1', ocrText: 'Units Consumed 248');
  }
}

late FakeUtilityService service;
late FakeUploader uploader;

Future<void> pump(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1200, 6000);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        utilityServiceProvider.overrideWithValue(service),
        billUploaderProvider.overrideWithValue(uploader),
        currentUserIdProvider.overrideWithValue('u1'),
      ],
      child: MaterialApp(home: screen),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> chooseProvider(WidgetTester tester, String name) async {
  await tester.tap(find.byKey(const Key('utility-provider')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(name).last);
  await tester.pumpAndSettle();
}

class _FakeFootprint implements FootprintService {
  Map<String, String> lastSources = const {};
  FootprintInputs? lastInputs;
  final result = FootprintResult.fromMap(
    jsonDecode(File('test/fixtures/footprint_estimate.json').readAsStringSync())
        as Map<String, dynamic>,
  );

  @override
  Future<FootprintResult> estimate(FootprintInputs inputs) async => result;

  @override
  Future<FootprintResult> save(
    FootprintInputs inputs,
    String monthKey, {
    Map<String, String> sources = const {},
  }) async {
    lastInputs = inputs;
    lastSources = sources;
    return result;
  }

  @override
  Future<void> delete(String monthKey) async {}

  @override
  Future<Methodology> methodology() async => Methodology.fromMap(
    jsonDecode(
          File('test/fixtures/footprint_methodology.json').readAsStringSync(),
        )
        as Map<String, dynamic>,
  );
}

class _NoTrees extends TreesController {
  @override
  Future<List<Tree>> build() async => const [];
}

void footprintTests() {
  group('footprint auto-fill', () {
    testWidgets(
      'a picked bill fills electricity, says where it came from, and is sent as the source',
      (tester) async {
        final now = DateTime.now().toUtc();
        final start = DateTime.utc(now.year, now.month, 1);
        String day(DateTime d) => isoDay(d);
        service.readings = [
          UtilityReading.fromMap(
            _readingMap(start: day(start), end: day(start)),
          ),
        ];
        final footprint = _FakeFootprint();

        tester.view.physicalSize = const Size(1200, 14000);
        tester.view.devicePixelRatio = 2;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              utilityServiceProvider.overrideWithValue(service),
              currentUserIdProvider.overrideWithValue('u1'),
              footprintServiceProvider.overrideWithValue(footprint),
              footprintHistoryProvider.overrideWith(
                (ref) async => const <FootprintEntry>[],
              ),
              speciesProvider.overrideWith(
                (ref) async => const <Species>[
                  Species(code: 'neem', name: 'Neem', co2PerYearGrams: 21000),
                ],
              ),
              treesControllerProvider.overrideWith(_NoTrees.new),
            ],
            child: const MaterialApp(home: FootprintScreen()),
          ),
        );
        await tester.pump(const Duration(milliseconds: 100));

        await tester.tap(find.byKey(const Key('import-history')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('248 kWh'));
        await tester.pumpAndSettle();

        final kwh = find.widgetWithText(TextField, 'Electricity used');
        expect(tester.widget<TextField>(kwh).controller!.text, '248');
        expect(find.textContaining('imported from your bill'), findsOneWidget);

        await tester.tap(find.widgetWithText(FilledButton, 'Work it out'));
        await tester.pump(const Duration(milliseconds: 200));
        await tester.tap(find.textContaining('Save for'));
        await tester.pump(const Duration(milliseconds: 200));
        expect(footprint.lastSources, {'electricityKwh': 'r1'});
        expect(footprint.lastInputs!.electricityKwh, 248);

        // Edited, the figure is the user's own: the note goes and no source is sent.
        await tester.enterText(kwh, '250');
        await tester.pump();
        expect(find.textContaining('imported from your'), findsNothing);
        await tester.tap(find.widgetWithText(FilledButton, 'Work it out'));
        await tester.pump(const Duration(milliseconds: 200));
        await tester.tap(find.textContaining('Save for'));
        await tester.pump(const Duration(milliseconds: 200));
        expect(footprint.lastSources, isEmpty);

        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(seconds: 5));
      },
    );
  });
}

void main() {
  setUp(() {
    service = FakeUtilityService();
    uploader = FakeUploader();
  });

  footprintTests();

  group('models', () {
    test(
      'every status has a label and an explanation, and only verified is verified',
      () {
        for (final s in UtilityStatus.values) {
          expect(s.label, isNotEmpty);
          expect(s.explanation, isNotEmpty);
        }
        expect(
          UtilityStatus.parse('consumption_unavailable').explanation,
          contains('actual consumption data was not available'),
        );
        expect(
          UtilityStatus.parse('unsupported_provider').explanation,
          contains('currently unavailable'),
        );
        expect(UtilityStatus.parse('nonsense'), UtilityStatus.failed);
        expect(sourceLabel(UtilityStatus.verified), contains('verified'));
        expect(
          sourceLabel(UtilityStatus.documentReview),
          contains('verification pending'),
        );
        expect(
          sourceLabel(UtilityStatus.unverified),
          contains('not independently verified'),
        );
      },
    );

    test('account numbers are validated with the provider\'s own rule', () {
      final msedcl = _catalog.providers.first;
      expect(msedcl.validateAccount('1234 5678 9012'), isNull);
      expect(msedcl.validateAccount('12345678901'), isNotNull);
      expect(msedcl.validateAccount(''), isNotNull);
    });

    test('a reading counts towards the month its period ends in', () {
      final r = UtilityReading.fromMap(
        _readingMap(start: '2026-09-20', end: '2026-10-19'),
      );
      expect(r.monthKey, '2026-10');
      final gas = UtilityReading.fromMap(
        _readingMap(type: 'png', unit: 'SCM', carbon: 'pending_factor'),
      );
      expect(gas.carbonPending, isTrue);
      expect(gas.carbonKg, isNull);
    });
  });

  group('server without the utility routes', () {
    // What an older deployed server answers, word for word.
    const oldServer = ApiFailure(
      'not_found',
      'Unknown route /utilities/providers',
    );
    const newServer = ApiFailure(
      'unknown_route',
      'Unknown route /utilities/providers',
    );

    test('is shown as a plain message, never the raw route', () {
      for (final e in [oldServer, newServer]) {
        expect(isUnknownRoute(e), isTrue);
        expect(friendlyMessage(e), isNot(contains('/utilities')));
        expect(
          friendlyMessage(e),
          contains('has not been updated for this feature'),
        );
      }
      // An ordinary missing record keeps its own message.
      const missing = ApiFailure(
        'not_found',
        'That verification was not found.',
      );
      expect(isUnknownRoute(missing), isFalse);
      expect(friendlyMessage(missing), 'That verification was not found.');
    });

    testWidgets('the verify screen shows a retry, and retry recovers', (
      tester,
    ) async {
      service.catalogError = oldServer;
      await pump(
        tester,
        const UtilityVerifyScreen(type: UtilityType.electricity),
      );
      expect(
        find.textContaining('has not been updated for this feature'),
        findsOneWidget,
      );
      expect(find.textContaining('Unknown route'), findsNothing);

      service.catalogError = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Verify Electricity Connection'), findsOneWidget);
      await chooseProvider(tester, 'MSEDCL (Mahavitaran)');
      expect(find.byKey(const Key('utility-account')), findsOneWidget);
    });

    testWidgets('the history screen shows a retry, and retry recovers', (
      tester,
    ) async {
      service.historyError = const ApiFailure(
        'not_found',
        'Unknown route /utilities/consumption/history',
      );
      await pump(tester, const UtilityHistoryScreen());
      expect(
        find.textContaining('has not been updated for this feature'),
        findsOneWidget,
      );
      expect(find.textContaining('Unknown route'), findsNothing);

      service.historyError = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('No utility consumption records yet.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 2));
    });

    testWidgets('gas providers load and MGL can be chosen', (tester) async {
      await pump(tester, const UtilityVerifyScreen(type: UtilityType.png));
      await chooseProvider(tester, 'Mahanagar Gas (MGL)');
      expect(find.byKey(const Key('utility-account')), findsOneWidget);
    });
  });

  group('verify screen', () {
    testWidgets('electricity shows only electricity providers', (tester) async {
      await pump(
        tester,
        const UtilityVerifyScreen(type: UtilityType.electricity),
      );
      expect(find.text('Verify Electricity Connection'), findsOneWidget);
      expect(find.text('India'), findsOneWidget);
      expect(find.text('Maharashtra'), findsOneWidget);
      await tester.tap(find.byKey(const Key('utility-provider')));
      await tester.pumpAndSettle();
      expect(find.text('MSEDCL (Mahavitaran)'), findsWidgets);
      expect(find.text('Mahanagar Gas (MGL)'), findsNothing);
    });

    testWidgets('gas shows only gas providers', (tester) async {
      await pump(tester, const UtilityVerifyScreen(type: UtilityType.png));
      expect(find.text('Verify Gas Connection'), findsOneWidget);
      await tester.tap(find.byKey(const Key('utility-provider')));
      await tester.pumpAndSettle();
      expect(find.text('Mahanagar Gas (MGL)'), findsWidgets);
      expect(find.text('BEST Mumbai'), findsNothing);
    });

    testWidgets(
      'every provider says fetching is not configured and offers upload',
      (tester) async {
        await pump(
          tester,
          const UtilityVerifyScreen(type: UtilityType.electricity),
        );
        expect(
          find.textContaining('Automatic bill fetching is not configured yet'),
          findsOneWidget,
        );
        await chooseProvider(tester, 'BEST Mumbai');
        expect(find.text('Upload your bill'), findsOneWidget);
        expect(find.textContaining('Fetch'), findsNothing);
      },
    );

    testWidgets('the consumer number is checked before anything is sent', (
      tester,
    ) async {
      await pump(
        tester,
        const UtilityVerifyScreen(type: UtilityType.electricity),
      );
      await chooseProvider(tester, 'MSEDCL (Mahavitaran)');
      await tester.enterText(find.byKey(const Key('utility-account')), '123');
      await tester.tap(find.byKey(const Key('utility-next')));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('does not look like a valid consumer number'),
        findsOneWidget,
      );
      expect(service.calls, isEmpty);
    });

    testWidgets('a valid consumer number goes straight to bill upload', (
      tester,
    ) async {
      await pump(
        tester,
        const UtilityVerifyScreen(type: UtilityType.electricity),
      );
      await chooseProvider(tester, 'MSEDCL (Mahavitaran)');
      await tester.enterText(
        find.byKey(const Key('utility-account')),
        '123456789012',
      );
      await tester.tap(find.byKey(const Key('utility-next')));
      await tester.pumpAndSettle();

      expect(find.byType(UtilityUploadScreen), findsOneWidget);
      expect(service.calls, isEmpty);
      expect(find.text('Verified'), findsNothing);
    });

    testWidgets('gas upload offers only SCM as the consumption unit', (
      tester,
    ) async {
      await pump(
        tester,
        UtilityUploadScreen(
          type: UtilityType.png,
          provider: _catalog.forType(UtilityType.png).first,
          account: 'BP12345678',
          picker: (_, _) async => null,
        ),
      );
      expect(find.byKey(const Key('bill-unit')), findsOneWidget);
      expect(find.text('SCM (standard cubic metres)'), findsOneWidget);
    });
  });

  group('upload screen', () {
    UtilityUploadScreen screen({BillPicker? picker}) => UtilityUploadScreen(
      type: UtilityType.electricity,
      provider: _catalog.providers.first,
      account: '123456789012',
      picker: picker ?? (_, _) async => '/tmp/bill.jpg',
    );

    testWidgets(
      'a picked bill is read and its figures suggested, then held for review',
      (tester) async {
        service.extracted = ExtractedBill(
          consumptionValue: 248,
          periodStart: DateTime(2026, 10, 1),
          periodEnd: DateTime(2026, 10, 31),
        );
        await pump(tester, screen());
        await tester.tap(find.byKey(const Key('bill-gallery')));
        await tester.pumpAndSettle();

        expect(uploader.uploads, 1);
        expect(service.calls, ['extract']);
        expect(
          find.textContaining('Some figures were read from it'),
          findsOneWidget,
        );
        expect(
          tester
              .widget<TextFormField>(find.byKey(const Key('bill-consumption')))
              .controller!
              .text,
          '248',
        );

        // Consent is still required.
        await tester.tap(find.byKey(const Key('bill-submit')));
        await tester.pumpAndSettle();
        expect(service.calls, ['extract']);

        await tester.tap(find.byKey(const Key('bill-consent')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('bill-submit')));
        await tester.pumpAndSettle();

        expect(service.calls, ['extract', 'submit']);
        expect(service.lastBillFileId, 'file1');
        expect(service.lastConsumption, 248);
        expect(find.textContaining('pending review'), findsWidgets);
        expect(find.text('Verified'), findsNothing);
      },
    );

    testWidgets('cancelling the picker uploads nothing', (tester) async {
      await pump(tester, screen(picker: (_, _) async => null));
      await tester.tap(find.byKey(const Key('bill-pdf')));
      await tester.pumpAndSettle();
      expect(uploader.uploads, 0);
    });
  });

  group('history', () {
    testWidgets('lists bills with their source and pending gas carbon', (
      tester,
    ) async {
      service.readings = [
        UtilityReading.fromMap(_readingMap(status: 'unverified')),
        UtilityReading.fromMap(
          _readingMap(
            id: 'g1',
            type: 'png',
            unit: 'SCM',
            value: 14.5,
            status: 'document_review',
            carbon: 'pending_factor',
          ),
        ),
      ];
      await pump(tester, const UtilityHistoryScreen());
      expect(find.text('248 kWh'), findsOneWidget);
      expect(find.text('14.5 SCM'), findsOneWidget);
      expect(find.text('Calculation pending'), findsOneWidget);
      expect(find.textContaining('User-entered'), findsOneWidget);
      expect(find.textContaining('Official provider data'), findsNothing);
      expect(
        find.textContaining('Extracted from uploaded bill'),
        findsOneWidget,
      );
    });

    testWidgets(
      'a bill already counted in another month cannot be picked again',
      (tester) async {
        service.readings = [
          UtilityReading.fromMap(_readingMap(applied: '2026-09')),
        ];
        UtilityReading? picked;
        tester.view.physicalSize = const Size(1200, 6000);
        tester.view.devicePixelRatio = 2;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              utilityServiceProvider.overrideWithValue(service),
              currentUserIdProvider.overrideWithValue('u1'),
            ],
            child: MaterialApp(
              home: Builder(
                builder: (context) => TextButton(
                  onPressed: () async =>
                      picked = await UtilityHistoryScreen.push(
                        context,
                        pickFor: '2026-10',
                      ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('248 kWh'));
        await tester.pumpAndSettle();
        expect(picked, isNull);
        expect(find.text('Choose a bill'), findsOneWidget);
      },
    );

    testWidgets('an empty history explains what to do', (tester) async {
      await pump(tester, const UtilityHistoryScreen());
      expect(find.text('No utility consumption records yet.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 2));
    });
  });

  group('provider list without the server', () {
    Future<String> bundledJson() =>
        File('assets/config/utility_providers.json').readAsString();

    test('the service falls back to the bundled providers', () async {
      final api = _FailingApi(
        const ApiFailure('unknown_route', 'Unknown route /utilities/providers'),
      );
      final catalog = await ApiUtilityService(
        api,
        bundledList: bundledJson,
      ).catalog();
      expect(api.paths, ['/utilities/providers']);
      expect(catalog.fromServer, isFalse);
      expect(catalog.serverProblem, contains('has not been updated'));
      final ids = [
        for (final p in catalog.forType(UtilityType.electricity)) p.id,
      ];
      expect(ids, contains('msedcl'));
      expect([
        for (final p in catalog.forType(UtilityType.png)) p.id,
      ], containsAll(['mgl', 'mngl']));
    });

    test('an offline phone still gets the bundled providers', () async {
      final catalog = await ApiUtilityService(
        _FailingApi(const SocketException('no network')),
        bundledList: bundledJson,
      ).catalog();
      expect(catalog.fromServer, isFalse);
      expect(catalog.forType(UtilityType.electricity), isNotEmpty);
    });

    testWidgets('the verify screen lets the user pick a provider and go on', (
      tester,
    ) async {
      final bundled = UtilityCatalog.fromMap(
        jsonDecode(await tester.runAsync(bundledJson) ?? '{}')
            as Map<String, dynamic>,
      ).bundled('Unable to connect to Dhara\u2019s server.');
      service.catalogValue = bundled;
      await pump(
        tester,
        const UtilityVerifyScreen(type: UtilityType.electricity),
      );
      expect(find.byKey(const Key('utility-manual-notice')), findsOneWidget);
      expect(find.textContaining('Unable to connect to Dhara'), findsOneWidget);
      expect(
        find.textContaining('Automatic bill fetching is not configured yet'),
        findsOneWidget,
      );
      await chooseProvider(tester, 'MSEDCL (Mahavitaran)');
      await tester.enterText(
        find.byKey(const Key('utility-account')),
        '123456789012',
      );
      await tester.tap(find.byKey(const Key('utility-next')));
      await tester.pumpAndSettle();
      expect(find.byType(UtilityUploadScreen), findsOneWidget);
      expect(service.calls, isNot(contains('fetch')));
    });
  });
}

class _FailingApi implements Api {
  _FailingApi(this.error);

  final Object error;
  final paths = <String>[];

  @override
  Future<Map<String, dynamic>> postIdempotent(
    String path, [
    Map<String, dynamic> body = const {},
    Duration retryDelay = Duration.zero,
  ]) async {
    paths.add(path);
    throw error;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
