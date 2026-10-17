import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/utils/tree_co2.dart';
import '../../../data/models/footprint.dart';
import '../../../state/footprint_controller.dart';
import '../../widgets/common.dart';
import '../../widgets/footprint_widgets.dart';

/// Where every number comes from, and what it leaves out.
///
/// Served by the same server that does the calculation, so this page cannot
/// quote a different factor from the one actually used.
class MethodologyScreen extends ConsumerWidget {
  const MethodologyScreen({super.key});

  static Future<void> push(BuildContext context) {
    Haptics.tap();
    return Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const MethodologyScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final m = ref.watch(methodologyProvider);

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(title: const Text('How we calculate')),
      body: SafeArea(
        child: m.when(
          loading: () => const Padding(
            padding: EdgeInsets.only(top: 24),
            child: LoadingList(count: 3, height: 120),
          ),
          error: (e, _) => Padding(
            padding: const EdgeInsets.all(20),
            child: ErrorRetry(
              message: friendlyMessage(e),
              onRetry: () => ref.invalidate(methodologyProvider),
            ),
          ),
          data: (data) => _Body(m: data),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.m});

  final Methodology m;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
      children: [
        Text(
          'Emission factors version ${m.version}, checked ${m.retrieved}.',
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.inkFaint),
        ),
        const SizedBox(height: 10),
        _Block(title: 'What is counted', children: [_Para(m.scope)]),
        const _Title('Emission factors'),
        for (final f in m.factors) _FactorCard(f: f),
        const _Title('For comparison'),
        DharaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Bench(b: m.india),
              const Divider(height: 24, color: AppColors.outline),
              _Bench(b: m.world),
            ],
          ),
        ),
        _Block(title: 'What is not counted', children: [for (final e in m.exclusions) _Bullet(e)]),
        _Block(title: 'Limits of this estimate', children: [for (final c in m.caveats) _Bullet(c)]),
        const _Block(
          title: 'Your data',
          children: [
            _Bullet('Nothing is stored until you tap Save.'),
            _Bullet('Saved footprints can be read only by you.'),
            _Bullet(
              'Our team sees totals across many members, never your own numbers. '
              'Totals are hidden until enough members have saved one that no '
              'individual can be picked out.',
            ),
            _Bullet('You can delete any saved month from your history.'),
          ],
        ),
      ],
    );
  }
}

class _Title extends StatelessWidget {
  const _Title(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 22, 0, 10),
        child: Text(
          text,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800, color: AppColors.forest),
        ),
      );
}

class _Block extends StatelessWidget {
  const _Block({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [_Title(title), DharaCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children))],
      );
}

class _Para extends StatelessWidget {
  const _Para(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(fontSize: 13, height: 1.5, fontWeight: FontWeight.w500, color: AppColors.ink),
      );
}

class _Bullet extends StatelessWidget {
  const _Bullet(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 6, right: 10),
              child: Icon(Icons.circle, size: 5, color: AppColors.inkFaint),
            ),
            Expanded(
              child: Text(text, style: const TextStyle(fontSize: 12.5, height: 1.5, fontWeight: FontWeight.w500, color: AppColors.inkSoft)),
            ),
          ],
        ),
      );
}

class _FactorCard extends StatelessWidget {
  const _FactorCard({required this.f});

  final MethodFactor f;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: DharaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(f.label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: AppColors.forest))),
                  if (f.confidence != 'high') ApproximateTag(confidence: f.confidence),
                ],
              ),
              const SizedBox(height: 4),
              Text.rich(TextSpan(children: [
                TextSpan(text: '${f.value}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.ink)),
                TextSpan(text: '  ${f.unit}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.inkSoft)),
              ])),
              const SizedBox(height: 8),
              Text(f.note, style: const TextStyle(fontSize: 12, height: 1.45, fontWeight: FontWeight.w600, color: AppColors.inkSoft)),
              const SizedBox(height: 8),
              Text('Source: ${f.source}', style: const TextStyle(fontSize: 10.5, height: 1.45, fontWeight: FontWeight.w500, color: AppColors.inkFaint)),
            ],
          ),
        ),
      );
}

class _Bench extends StatelessWidget {
  const _Bench({required this.b});

  final MethodBenchmark b;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(b.label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.ink))),
              Text('${formatCo2(b.kgPerYear)} (${b.year})', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: AppColors.forest)),
            ],
          ),
          const SizedBox(height: 4),
          Text(b.source, style: const TextStyle(fontSize: 10.5, height: 1.45, fontWeight: FontWeight.w500, color: AppColors.inkFaint)),
        ],
      );
}
