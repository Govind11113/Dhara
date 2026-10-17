import 'dart:convert';
import 'dart:io';

import 'package:dhara/core/services/api.dart';
import 'package:dhara/core/utils/tree_co2.dart';
import 'package:dhara/data/models/footprint.dart';
import 'package:dhara/data/models/tree.dart';
import 'package:dhara/state/footprint_controller.dart';
import 'package:dhara/state/trees_controller.dart';
import 'package:dhara/ui/screens/footprint/footprint_screen.dart';
import 'package:dhara/ui/screens/footprint/methodology_screen.dart';
import 'package:dhara/ui/widgets/climate_cards.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> fixture(String name) =>
    jsonDecode(File('test/fixtures/$name').readAsStringSync()) as Map<String, dynamic>;

class FakeService implements FootprintService {
  final calls = <String>[];
  FootprintInputs? lastInputs;
  String? lastMonth;
  Object? failWith;
  Object? methodologyFails;

  final result = FootprintResult.fromMap(fixture('footprint_estimate.json'));

  @override
  Future<FootprintResult> estimate(FootprintInputs inputs) async {
    calls.add('estimate');
    lastInputs = inputs;
    if (failWith != null) throw failWith!;
    return result;
  }

  @override
  Future<FootprintResult> save(FootprintInputs inputs, String monthKey) async {
    calls.add('save');
    lastInputs = inputs;
    lastMonth = monthKey;
    if (failWith != null) throw failWith!;
    return result;
  }

  @override
  Future<void> delete(String monthKey) async {
    calls.add('delete:$monthKey');
  }

  @override
  Future<Methodology> methodology() async {
    calls.add('methodology');
    if (methodologyFails != null) throw methodologyFails!;
    return Methodology.fromMap(fixture('footprint_methodology.json'));
  }
}

class _NoTrees extends TreesController {
  @override
  Future<List<Tree>> build() async => const [];
}

class _MyTrees extends TreesController {
  @override
  Future<List<Tree>> build() async => [
        for (var i = 0; i < 2; i++)
          Tree(
            id: 't$i', ownerId: 'u', speciesCode: 'neem', speciesName: 'Neem',
            lat: 0, lng: 0, plantedAt: DateTime(2026, 1, 1), status: TreeStatus.alive,
          ),
      ];
}

const _species = [
  Species(code: 'neem', name: 'Neem', co2PerYearGrams: 21000),
  Species(code: 'bamboo', name: 'Bamboo', co2PerYearGrams: 30000),
];

FootprintEntry entry(String month, double kg, {FootprintInputs? inputs}) => FootprintEntry(
      id: 'f$month', monthKey: month, monthKg: kg, yearKg: kg * 12,
      electricityKg: kg * 0.4, cookingKg: kg * 0.1, transportKg: kg * 0.3, airKg: kg * 0.2,
      factorsVersion: '2026.1', inputs: inputs,
    );

late FakeService service;
int historyBuilds = 0;

List<Override> overrides({
  List<FootprintEntry> history = const [],
  bool myTrees = false,
}) =>
    [
      footprintServiceProvider.overrideWithValue(service),
      footprintHistoryProvider.overrideWith((ref) async {
        historyBuilds++;
        return history;
      }),
      speciesProvider.overrideWith((ref) async => _species),
      treesControllerProvider.overrideWith(myTrees ? _MyTrees.new : _NoTrees.new),
    ];

Future<void> show(WidgetTester tester, Widget screen, {List<FootprintEntry> history = const [], bool myTrees = false}) async {
  tester.view.physicalSize = const Size(1200, 14000);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(ProviderScope(overrides: overrides(history: history, myTrees: myTrees), child: MaterialApp(home: screen)));
  await tester.pump(const Duration(milliseconds: 100));
}

Future<void> finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 5));
}

final workItOut = find.widgetWithText(FilledButton, 'Work it out');
Finder field(String label) => find.widgetWithText(TextField, label);

void main() {
  setUp(() {
    service = FakeService();
    historyBuilds = 0;
  });

  group('calculator', () {
    testWidgets('starts disabled and explains why', (tester) async {
      await show(tester, const FootprintScreen());
      expect(tester.widget<FilledButton>(workItOut).onPressed, isNull);
      expect(find.text('Enter at least one thing above to continue.'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('typing something enables it, and exactly what was typed is sent', (tester) async {
      await show(tester, const FootprintScreen());
      await tester.enterText(field('Electricity used'), '200');
      await tester.enterText(field('Cooking gas'), '1');
      await tester.enterText(field('Bus'), '100');
      await tester.pump();

      expect(tester.widget<FilledButton>(workItOut).onPressed, isNotNull);
      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));

      expect(service.calls, ['estimate']);
      final sent = service.lastInputs!;
      expect((sent.electricityKwh, sent.lpgCylinders, sent.householdSize), (200.0, 1.0, 1));
      expect(sent.travel['bus'], 100);
      await finish(tester);
    });

    testWidgets('shows the result the server returned, in plain units', (tester) async {
      await show(tester, const FootprintScreen());
      await tester.enterText(field('Electricity used'), '200');
      await tester.pump();
      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('157 kg'), findsOneWidget); // 156.8, whole kg past ten
      expect(find.textContaining('About 1.9 t a year'), findsOneWidget);
      // Twice: the form field of that name, and its line in the result.
      expect(find.text('Flight within India'), findsNWidgets(2));
      expect(find.text('Grid electricity'), findsOneWidget);
      expect(find.textContaining('Emission factors version 2026.1'), findsOneWidget);
      await finish(tester);
    });

    // Approximate lines are flagged; Indian-sourced ones are not.
    testWidgets('lines resting on UK figures carry an approximate tag, the grid line does not', (tester) async {
      await show(tester, const FootprintScreen());
      await tester.enterText(field('Electricity used'), '200');
      await tester.pump();
      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));

      // flight, car and bus are UK-derived in the fixture; electricity and gas are not.
      expect(find.text('approximate'), findsNWidgets(3));
      await finish(tester);
    });

    testWidgets('compares with India and the world and says what the comparison is', (tester) async {
      await show(tester, const FootprintScreen());
      await tester.enterText(field('Electricity used'), '200');
      await tester.pump();
      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('India, average per person (2024)'), findsOneWidget);
      expect(find.text('2.2 t'), findsOneWidget);
      expect(find.text('4.7 t'), findsOneWidget);
      expect(find.textContaining('shows scale rather than a score'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('compares with trees, as a reality check and not an offset', (tester) async {
      await show(tester, const FootprintScreen(), myTrees: true);
      await tester.enterText(field('Electricity used'), '200');
      await tester.pump();
      await tester.tap(workItOut);
      // The species and tree lists load after the result first builds: one pump
      // to let them resolve, one to rebuild with them.
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Against trees'), findsOneWidget);
      expect(find.textContaining('Your 2 trees will take in about 42 kg a year once grown'), findsOneWidget);
      expect(find.textContaining('not an offset'), findsOneWidget);
      await finish(tester);
    });

    // The numbers changed, so the old result no longer describes them.
    testWidgets('editing after a result hides it and asks to work it out again', (tester) async {
      await show(tester, const FootprintScreen());
      await tester.enterText(field('Electricity used'), '200');
      await tester.pump();
      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.textContaining('157 kg'), findsOneWidget);

      await tester.enterText(field('Electricity used'), '250');
      await tester.pump();

      expect(find.textContaining('157 kg'), findsNothing);
      expect(find.textContaining('You changed the numbers'), findsOneWidget);
      expect(find.textContaining('Save for'), findsNothing);
      await finish(tester);
    });

    testWidgets('a refusal from the server is shown in words, not swallowed', (tester) async {
      service.failWith = const ApiFailure('invalid_input', 'Electricity looks too high (the most we accept is 50000). Check the number.');
      await show(tester, const FootprintScreen());
      await tester.enterText(field('Electricity used'), '99999');
      await tester.pump();
      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('Electricity looks too high'), findsOneWidget);
      expect(find.text('Save for'), findsNothing);
      await finish(tester);
    });

    testWidgets('car occupants appear only once a car is used', (tester) async {
      await show(tester, const FootprintScreen());
      expect(find.text('People usually in the car'), findsNothing);

      await tester.enterText(field('Car (petrol)'), '100');
      await tester.pump();
      expect(find.text('People usually in the car'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('household size and occupants are sent', (tester) async {
      await show(tester, const FootprintScreen());
      await tester.enterText(field('Electricity used'), '200');
      await tester.enterText(field('Car (petrol)'), '100');
      await tester.pump();

      Finder more(String label) => find.descendant(
            of: find.ancestor(of: find.text(label), matching: find.byType(Row)).first,
            matching: find.byTooltip('One more'),
          );
      // One tap per frame: a second tap in the same frame would act on the
      // button as it was before the first one rebuilt it.
      for (final label in ['People in your household', 'People in your household', 'People usually in the car']) {
        await tester.tap(more(label));
        await tester.pump();
      }

      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));
      expect((service.lastInputs!.householdSize, service.lastInputs!.carOccupants), (3, 2));
      await finish(tester);
    });
  });

  group('number fields', () {
    Future<String> typed(WidgetTester tester, String text) async {
      await tester.enterText(field('Electricity used'), text);
      await tester.pump();
      return tester.widget<TextField>(field('Electricity used')).controller!.text;
    }

    testWidgets('only digits and one decimal point are accepted', (tester) async {
      await show(tester, const FootprintScreen());
      expect(await typed(tester, '12.5'), '12.5');
      expect(await typed(tester, '12.5a'), '12.5');
      expect(await typed(tester, '-4'), '12.5');
      expect(await typed(tester, '1.2.3'), '12.5');
      await finish(tester);
    });

    testWidgets('limited to two decimals and six whole digits', (tester) async {
      await show(tester, const FootprintScreen());
      expect(await typed(tester, '3.14'), '3.14');
      expect(await typed(tester, '3.145'), '3.14');
      expect(await typed(tester, '1234567'), '3.14');
      expect(await typed(tester, '123456'), '123456');
      await finish(tester);
    });

    test('formatter unit behaviour', () {
      const f = DecimalFormatter();
      TextEditingValue run(String old, String next) =>
          f.formatEditUpdate(TextEditingValue(text: old), TextEditingValue(text: next));
      expect(run('', '7').text, '7');
      expect(run('7', '7.').text, '7.');
      expect(run('7.', '7.5').text, '7.5');
      expect(run('7.5', '7.55').text, '7.55');
      expect(run('7.55', '7.555').text, '7.55');
      expect(run('7', '7e1').text, '7');
      expect(run('', '').text, '');
    });
  });

  group('saving and history', () {
    testWidgets('saving sends the chosen month and confirms', (tester) async {
      await show(tester, const FootprintScreen());
      await tester.enterText(field('Electricity used'), '200');
      await tester.pump();
      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));

      final month = recentMonthKeys().first;
      await tester.tap(find.text('Save for ${monthLabel(month)}'));
      await tester.pump(const Duration(milliseconds: 100));

      expect(service.calls, ['estimate', 'save']);
      expect(service.lastMonth, month);
      expect(find.text('Saved for ${monthLabel(month)}.'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('saving refreshes the history', (tester) async {
      await show(tester, const FootprintScreen());
      final before = historyBuilds;
      await tester.enterText(field('Electricity used'), '200');
      await tester.pump();
      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(find.textContaining('Save for'));
      await tester.pump(const Duration(milliseconds: 200));

      expect(historyBuilds, greaterThan(before));
      await finish(tester);
    });

    testWidgets('a month that is already saved offers Update, not Save', (tester) async {
      final month = recentMonthKeys().first;
      await show(tester, const FootprintScreen(),
          history: [entry(month, 150, inputs: const FootprintInputs(electricityKwh: 180))]);
      await tester.pump(const Duration(milliseconds: 200));

      // The form is filled from the saved month.
      expect(tester.widget<TextField>(field('Electricity used')).controller!.text, '180');

      await tester.tap(workItOut);
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Update ${monthLabel(month)}'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('switching to another saved month loads its numbers', (tester) async {
      final months = recentMonthKeys();
      await show(tester, const FootprintScreen(), history: [
        entry(months[0], 150, inputs: const FootprintInputs(electricityKwh: 180, householdSize: 2)),
        entry(months[1], 120, inputs: const FootprintInputs(electricityKwh: 90, travel: {'bus': 33})),
      ]);
      await tester.pump(const Duration(milliseconds: 200));
      expect(tester.widget<TextField>(field('Electricity used')).controller!.text, '180');

      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('${monthLabel(months[1])}  \u00B7  saved').last);
      await tester.pumpAndSettle();

      expect(tester.widget<TextField>(field('Electricity used')).controller!.text, '90');
      expect(tester.widget<TextField>(field('Bus')).controller!.text, '33');
      await finish(tester);
    });

    testWidgets('an unsaved month starts blank', (tester) async {
      final months = recentMonthKeys();
      await show(tester, const FootprintScreen(),
          history: [entry(months[0], 150, inputs: const FootprintInputs(electricityKwh: 180))]);
      await tester.pump(const Duration(milliseconds: 200));

      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text(monthLabel(months[3])).last);
      await tester.pumpAndSettle();

      expect(tester.widget<TextField>(field('Electricity used')).controller!.text, '');
      await finish(tester);
    });

    testWidgets('lists saved months and charts them from two onward', (tester) async {
      final months = recentMonthKeys();
      await show(tester, const FootprintScreen(), history: [entry(months[0], 150), entry(months[1], 120)]);
      await tester.pump(const Duration(milliseconds: 200));

      expect(find.text('Your history'), findsOneWidget);
      expect(find.byTooltip('Delete ${entry(months[0], 1).label}'), findsOneWidget);
      expect(find.text('kg CO\u2082e a month'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('one month is a list entry, not a chart', (tester) async {
      await show(tester, const FootprintScreen(), history: [entry(recentMonthKeys().first, 150)]);
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('Your history'), findsOneWidget);
      expect(find.text('kg CO\u2082e a month'), findsNothing);
      await finish(tester);
    });

    testWidgets('deleting asks first, and only then deletes', (tester) async {
      final month = recentMonthKeys().first;
      await show(tester, const FootprintScreen(), history: [entry(month, 150)]);
      await tester.pump(const Duration(milliseconds: 200));

      await tester.tap(find.byTooltip('Delete ${entry(month, 1).label}'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Keep'));
      await tester.pumpAndSettle();
      expect(service.calls, isNot(contains('delete:$month')));

      await tester.tap(find.byTooltip('Delete ${entry(month, 1).label}'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(service.calls, contains('delete:$month'));
      await finish(tester);
    });

    testWidgets('has a link to how it is calculated', (tester) async {
      await show(tester, const FootprintScreen());
      await tester.tap(find.text('How we calculate this'));
      await tester.pumpAndSettle();
      expect(find.byType(MethodologyScreen), findsOneWidget);
      await finish(tester);
    });
  });

  group('tree comparison sentence', () {
    TreeCo2 trees(int n, double mine) => TreeCo2(avgKgPerYear: 21.2, myKgPerYear: mine, myLivingTrees: n);

    test('without trees it states only how many it would take', () {
      expect(treeComparison(trees(0, 0), 1881), 'It would take about 89 average grown trees a year to take in 1.9 t.');
    });

    test('with trees it adds their share', () {
      expect(treeComparison(trees(2, 42), 1881), contains('Your 2 trees will take in about 42 kg a year once grown'));
      expect(treeComparison(trees(2, 42), 1881), contains('about 2% of this'));
      expect(treeComparison(trees(1, 21), 1881), contains('Your tree will take in'));
    });

    test('a tiny share reads as under one percent, not zero', () {
      expect(treeComparison(trees(1, 5), 100000), contains('<1%'));
    });
  });

  group('months', () {
    test('twelve, newest first, across a year boundary', () {
      final keys = recentMonthKeys(now: DateTime(2026, 2, 10));
      expect(keys, hasLength(12));
      expect(keys.first, '2026-02');
      expect(keys[1], '2026-01');
      expect(keys[2], '2025-12');
      expect(keys.last, '2025-03');
      expect(keys.toSet(), hasLength(12));
    });

    test('labels', () {
      expect(monthLabel('2026-10'), 'October 2026');
      expect(monthLabel('nonsense'), 'nonsense');
    });
  });

  group('methodology page', () {
    testWidgets('shows every factor with its source, and the limits', (tester) async {
      await show(tester, const MethodologyScreen());
      await tester.pump(const Duration(milliseconds: 200));

      expect(find.textContaining('Emission factors version 2026.1'), findsOneWidget);
      expect(find.text('Grid electricity'), findsOneWidget);
      expect(find.textContaining('Central Electricity Authority'), findsOneWidget);
      expect(find.textContaining('0.727'), findsOneWidget);
      expect(find.text('rough guide'), findsOneWidget); // train and metro
      expect(find.text('What is not counted'), findsOneWidget);
      expect(find.textContaining('Food and diet'), findsOneWidget);
      expect(find.text('Limits of this estimate'), findsOneWidget);
      expect(find.text('Your data'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('shows the benchmarks with their source', (tester) async {
      await show(tester, const MethodologyScreen());
      await tester.pump(const Duration(milliseconds: 200));
      await tester.scrollUntilVisible(find.text('For comparison'), 300, scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('2.2 t (2024)'), findsOneWidget);
      expect(find.textContaining('Global Carbon Budget (2025)'), findsWidgets);
      await finish(tester);
    });

    testWidgets('a failure offers a retry that works', (tester) async {
      service.methodologyFails = const ApiFailure('function_error', 'No response from server. Please try again.');
      await show(tester, const MethodologyScreen());
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.textContaining('No response from server'), findsOneWidget);

      service.methodologyFails = null;
      await tester.tap(find.text('Try again'));
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.textContaining('Emission factors version'), findsOneWidget);
      await finish(tester);
    });
  });

  group('dashboard card', () {
    testWidgets('invites a first calculation when nothing is saved', (tester) async {
      await show(tester, const Scaffold(body: SingleChildScrollView(child: FootprintCard())));
      expect(find.text('Work out your footprint'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('shows the latest month and how it moved', (tester) async {
      final m = recentMonthKeys();
      await show(tester, const Scaffold(body: SingleChildScrollView(child: FootprintCard())),
          history: [entry(m[0], 90), entry(m[1], 120)]);
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.textContaining('90 kg'), findsOneWidget);
      expect(find.textContaining('25% lower than ${entry(m[1], 1).label}'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('tapping it opens the calculator', (tester) async {
      await show(tester, const Scaffold(body: SingleChildScrollView(child: FootprintCard())));
      await tester.tap(find.text('Work out your footprint'));
      await tester.pumpAndSettle();
      expect(find.byType(FootprintScreen), findsOneWidget);
      await finish(tester);
    });

    test('month-on-month arithmetic', () {
      expect(footprintChange(entry('2026-10', 90), entry('2026-09', 120)), closeTo(-25, 1e-9));
      expect(footprintChange(entry('2026-10', 150), entry('2026-09', 100)), closeTo(50, 1e-9));
      expect(footprintChange(entry('2026-10', 100), entry('2026-09', 100)), 0);
      expect(footprintChange(entry('2026-10', 100), entry('2026-09', 0)), isNull);
      expect(footprintChange(entry('2026-10', 100), null), isNull);
    });
  });
}
