import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/services/weather.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/growth.dart';
import '../../data/models/tree.dart';
import '../../state/trees_controller.dart';
import '../../state/weather_controller.dart';
import 'common.dart';

/// Trees under this age are the ones watering matters for.
const kYoungTreeDays = 730;

/// Whether to show care guidance for a tree at all: only a living, young one.
bool needsCareTip(Tree tree) =>
    tree.status.countsAsLiving && tree.ageInDays < kYoungTreeDays;

Color careColor(CareKind kind) => switch (kind) {
      CareKind.rainComing => AppColors.info,
      CareKind.soaked => AppColors.info,
      CareKind.hotAndDry => AppColors.danger,
      CareKind.dry => AppColors.amber,
      CareKind.mixed => AppColors.green,
    };

IconData careIcon(CareKind kind) => switch (kind) {
      CareKind.rainComing => Icons.water_drop_rounded,
      CareKind.soaked => Icons.water_drop_outlined,
      CareKind.hotAndDry => Icons.wb_sunny_rounded,
      CareKind.dry => Icons.opacity_rounded,
      CareKind.mixed => Icons.cloud_rounded,
    };

/// Whether to water, from the forecast where the tree stands.
class TreeCareCard extends ConsumerWidget {
  const TreeCareCard({super.key, required this.tree});

  final Tree tree;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!needsCareTip(tree)) return const SizedBox.shrink();

    final where = (
      lat: WeatherService.snap(tree.lat),
      lng: WeatherService.snap(tree.lng),
    );
    final forecast = ref.watch(forecastProvider(where));
    final speciesNote = ref
        .watch(speciesProvider)
        .value
        ?.where((s) => s.code == tree.speciesCode)
        .map((s) => s.careTip)
        .where((t) => t.isNotEmpty)
        .firstOrNull;

    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: forecast.when(
        loading: () => const LoadingList(count: 1, height: 110),
        error: (error, _) => DharaCard(
          child: Row(
            children: [
              const Icon(Icons.cloud_off_rounded, size: 20, color: AppColors.inkFaint),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Watering tip unavailable right now.',
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.inkSoft),
                ),
              ),
              TextButton(
                onPressed: () => ref.invalidate(forecastProvider(where)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (f) {
          final advice = careAdvice(f);
          if (advice == null) return const SizedBox.shrink();
          return _CareBody(advice: advice, speciesNote: speciesNote, speciesName: tree.speciesName);
        },
      ),
    );
  }
}

class _CareBody extends StatelessWidget {
  const _CareBody({required this.advice, required this.speciesNote, required this.speciesName});

  final CareAdvice advice;
  final String? speciesNote;
  final String speciesName;

  @override
  Widget build(BuildContext context) {
    final color = careColor(advice.kind);

    return DharaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: color.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(13)),
                child: Icon(careIcon(advice.kind), color: color, size: 22),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(advice.headline, style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: color)),
                    const SizedBox(height: 3),
                    Text(
                      advice.detail,
                      style: const TextStyle(fontSize: 12.5, height: 1.45, fontWeight: FontWeight.w500, color: AppColors.ink),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (speciesNote != null) ...[
            const Divider(height: 24, color: AppColors.outline),
            Text(
              '$speciesName: $speciesNote',
              style: const TextStyle(fontSize: 12, height: 1.45, fontWeight: FontWeight.w600, color: AppColors.inkSoft),
            ),
          ],
          const SizedBox(height: 10),
          const Text(
            'A general guide for young trees, based on the forecast for your '
            'area \u2014 not advice for this tree\'s soil. Weather data: Open-Meteo.com '
            '(CC BY 4.0).',
            style: TextStyle(fontSize: 10.5, height: 1.4, fontWeight: FontWeight.w500, color: AppColors.inkFaint),
          ),
        ],
      ),
    );
  }
}

/// Height over time, drawn from the approved check-ins.
class GrowthCard extends StatelessWidget {
  const GrowthCard({super.key, required this.points});

  final List<GrowthPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.length < 2) return const SizedBox.shrink();

    final first = points.first.at.millisecondsSinceEpoch.toDouble();
    final last = points.last.at.millisecondsSinceEpoch.toDouble();
    final span = (last - first) <= 0 ? 1.0 : last - first;
    final tallest = points.map((p) => p.heightCm).reduce((a, b) => a > b ? a : b).toDouble();
    final shortest = points.map((p) => p.heightCm).reduce((a, b) => a < b ? a : b).toDouble();
    final pad = ((tallest - shortest) * 0.2).clamp(5.0, 1e9);

    final summary = growthSummary(points);

    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: DharaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Growth', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: AppColors.forest)),
            if (summary != null) ...[
              const SizedBox(height: 4),
              Text(summary, style: const TextStyle(fontSize: 12.5, height: 1.4, fontWeight: FontWeight.w600, color: AppColors.inkSoft)),
            ],
            const SizedBox(height: 16),
            Semantics(
              label: 'Height over time. '
                  '${points.map((p) => '${DateFormat('MMM d').format(p.at.toLocal())}: ${p.heightCm} centimetres').join(', ')}',
              child: ExcludeSemantics(
                child: SizedBox(
                  height: 150,
                  child: LineChart(
                    LineChartData(
                      minX: 0,
                      maxX: 1,
                      minY: (shortest - pad).clamp(0, 1e9),
                      maxY: tallest + pad,
                      gridData: const FlGridData(drawVerticalLine: false),
                      borderData: FlBorderData(show: false),
                      lineTouchData: const LineTouchData(enabled: false),
                      titlesData: FlTitlesData(
                        topTitles: const AxisTitles(),
                        rightTitles: const AxisTitles(),
                        leftTitles: AxisTitles(
                          sideTitles: SideTitles(
                            showTitles: true,
                            reservedSize: 40,
                            getTitlesWidget: (v, meta) => v == meta.min || v == meta.max
                                ? const SizedBox.shrink()
                                : Text('${v.round()} cm', style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w600, color: AppColors.inkFaint)),
                          ),
                        ),
                        bottomTitles: AxisTitles(
                          sideTitles: SideTitles(
                            showTitles: true,
                            reservedSize: 22,
                            interval: 0.5,
                            getTitlesWidget: (v, meta) {
                              final at = DateTime.fromMillisecondsSinceEpoch((first + v * span).round());
                              return Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Text(DateFormat('MMM d').format(at.toLocal()), style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: AppColors.inkFaint)),
                              );
                            },
                          ),
                        ),
                      ),
                      lineBarsData: [
                        LineChartBarData(
                          spots: [
                            for (final p in points)
                              FlSpot((p.at.millisecondsSinceEpoch - first) / span, p.heightCm.toDouble()),
                          ],
                          isCurved: false,
                          color: AppColors.green,
                          barWidth: 3,
                          dotData: const FlDotData(),
                          belowBarData: BarAreaData(show: true, color: AppColors.green.withValues(alpha: 0.10)),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Heights are what you entered at each approved check-in.',
              style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w500, color: AppColors.inkFaint),
            ),
          ],
        ),
      ),
    );
  }
}
