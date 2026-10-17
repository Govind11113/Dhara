import 'package:dhara/ui/widgets/tree_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget host({String? error, VoidCallback? onRetry, Duration? patience}) =>
    MaterialApp(
      home: Scaffold(
        body: TreeMap(
          me: null,
          error: error,
          onRetry: onRetry,
          patience: patience ?? const Duration(seconds: 15),
        ),
      ),
    );

final finding = find.text('Finding you on the map\u2026');
final stillLooking = find.textContaining('Still looking for you');
final tryAgain = find.text('Try again');

void main() {
  group('while waiting for a position', () {
    testWidgets('says it is finding you, with a spinner and no retry yet', (tester) async {
      await tester.pumpWidget(host(onRetry: () {}));
      expect(finding, findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(tryAgain, findsNothing);
    });

    // The reported bug: a spinner that never ends and offers nothing to do.
    testWidgets('admits it is slow after the patience runs out, and offers a retry', (tester) async {
      var retries = 0;
      await tester.pumpWidget(host(onRetry: () => retries++));

      await tester.pump(const Duration(seconds: 14));
      expect(finding, findsOneWidget);
      expect(tryAgain, findsNothing);

      await tester.pump(const Duration(seconds: 2));
      expect(stillLooking, findsOneWidget);
      expect(finding, findsNothing);
      expect(tryAgain, findsOneWidget);

      await tester.tap(tryAgain);
      expect(retries, 1);
    });

    testWidgets('patience is configurable', (tester) async {
      await tester.pumpWidget(host(onRetry: () {}, patience: const Duration(seconds: 2)));
      await tester.pump(const Duration(seconds: 3));
      expect(stillLooking, findsOneWidget);
    });

    testWidgets('with no retry to offer it never shows a dead button', (tester) async {
      await tester.pumpWidget(host());
      await tester.pump(const Duration(seconds: 20));
      expect(stillLooking, findsOneWidget);
      expect(tryAgain, findsNothing);
    });
  });

  group('when location failed', () {
    testWidgets('shows the reason immediately instead of a spinner', (tester) async {
      await tester.pumpWidget(
        host(error: 'Turn on location services to continue.', onRetry: () {}),
      );
      expect(find.text('Turn on location services to continue.'), findsOneWidget);
      expect(finding, findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byIcon(Icons.location_off_rounded), findsOneWidget);
    });

    testWidgets('the retry is available straight away and works', (tester) async {
      var retries = 0;
      await tester.pumpWidget(host(error: 'No fix.', onRetry: () => retries++));
      await tester.tap(tryAgain);
      expect(retries, 1);
    });

    // After a retry the screen clears the error. The search is brand new, so the
    // map must go back to "finding" with a fresh clock, not straight to "still
    // looking" because the previous attempt ran long.
    testWidgets('a retry restarts the wait from the beginning', (tester) async {
      await tester.pumpWidget(host(error: 'No fix.', onRetry: () {}));
      await tester.pump(const Duration(seconds: 30));

      await tester.pumpWidget(host(onRetry: () {}));
      expect(finding, findsOneWidget);
      expect(stillLooking, findsNothing);

      await tester.pump(const Duration(seconds: 14));
      expect(finding, findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
      expect(stillLooking, findsOneWidget);
    });

    testWidgets('a new failure replaces the old message', (tester) async {
      await tester.pumpWidget(host(error: 'First problem.', onRetry: () {}));
      await tester.pumpWidget(host(error: 'Second problem.', onRetry: () {}));
      expect(find.text('First problem.'), findsNothing);
      expect(find.text('Second problem.'), findsOneWidget);
    });
  });

  testWidgets('leaving the screen cancels the timer (no leak, no late setState)', (tester) async {
    await tester.pumpWidget(host(onRetry: () {}));
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    // A timer left running would fail the test at teardown.
    await tester.pump(const Duration(seconds: 30));
  });

  testWidgets('the status is announced to screen readers', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(host(error: 'Location is off.', onRetry: () {}));
    expect(
      tester.getSemantics(find.text('Location is off.')).label,
      contains('Location is off.'),
    );
    handle.dispose();
  });
}
