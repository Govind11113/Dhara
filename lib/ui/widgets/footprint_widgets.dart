import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/utils/tree_co2.dart';
import '../../data/models/footprint.dart';

/// One colour per group, used by the bar, the legend and the history chart so a
/// colour means the same thing everywhere.
const _groupColors = <String, Color>{
  'electricity': AppColors.amber,
  'cooking': Color(0xFFE8833A),
  'transport': AppColors.info,
  'air': Color(0xFF8E44AD),
};

const _groupLabels = <String, String>{
  'electricity': 'Electricity',
  'cooking': 'Cooking gas',
  'transport': 'Road and rail',
  'air': 'Flying',
};

Color groupColor(String key) => _groupColors[key] ?? AppColors.inkFaint;
String groupLabel(String key) => _groupLabels[key] ?? key;

/// Groups in display order, skipping empty ones.
List<MapEntry<String, double>> nonEmptyGroups(Map<String, double> groups) => [
      for (final key in _groupLabels.keys)
        if ((groups[key] ?? 0) > 0) MapEntry(key, groups[key]!),
    ];

/// Small tag shown beside any line that is not backed by Indian data.
class ApproximateTag extends StatelessWidget {
  const ApproximateTag({super.key, required this.confidence});

  final String confidence;

  @override
  Widget build(BuildContext context) {
    final low = confidence == 'low';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: (low ? AppColors.danger : AppColors.amber).withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        low ? 'rough guide' : 'approximate',
        style: TextStyle(
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          color: low ? AppColors.danger : const Color(0xFF9A6200),
        ),
      ),
    );
  }
}

/// A single stacked bar showing how the month splits between groups, with a
/// legend underneath. The legend carries the numbers, so the bar is decoration
/// for sighted users and the text is what a screen reader gets.
class GroupSplitBar extends StatelessWidget {
  const GroupSplitBar({super.key, required this.groups});

  final Map<String, double> groups;

  @override
  Widget build(BuildContext context) {
    final parts = nonEmptyGroups(groups);
    final total = parts.fold<double>(0, (s, e) => s + e.value);
    if (parts.isEmpty || total <= 0) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: SizedBox(
              height: 12,
              child: Row(
                children: [
                  for (final e in parts)
                    Expanded(
                      flex: (e.value / total * 1000).round().clamp(1, 1000),
                      child: ColoredBox(color: groupColor(e.key)),
                    ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 16,
          runSpacing: 8,
          children: [
            for (final e in parts)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: groupColor(e.key),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    '${groupLabel(e.key)} \u00B7 ${formatKg(e.value)}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.inkSoft,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

/// Months side by side, each stacked by group.
///
/// Oldest on the left. Fewer than two months is not a trend, so the caller
/// shows this only from two onward.
class FootprintHistoryChart extends StatelessWidget {
  const FootprintHistoryChart({super.key, required this.entries});

  /// Any order; shown oldest to newest.
  final List<FootprintEntry> entries;

  @override
  Widget build(BuildContext context) {
    final months = ([...entries]..sort((a, b) => a.monthKey.compareTo(b.monthKey)));
    final shown = months.length > 12 ? months.sublist(months.length - 12) : months;
    if (shown.isEmpty) return const SizedBox.shrink();

    final peak = shown.map((e) => e.monthKg).reduce((a, b) => a > b ? a : b);
    final top = peak <= 0 ? 10.0 : peak * 1.15;

    final summary = shown
        .map((e) => '${e.label}: ${formatKg(e.monthKg)}')
        .join(', ');

    return Semantics(
      label: 'Monthly footprint. $summary',
      child: ExcludeSemantics(
        child: SizedBox(
          height: 170,
          child: BarChart(
            BarChartData(
              maxY: top,
              alignment: BarChartAlignment.spaceAround,
              gridData: FlGridData(
                drawVerticalLine: false,
                horizontalInterval: top / 4,
                getDrawingHorizontalLine: (_) =>
                    const FlLine(color: AppColors.outline, strokeWidth: 1),
              ),
              borderData: FlBorderData(show: false),
              barTouchData: BarTouchData(enabled: false),
              titlesData: FlTitlesData(
                topTitles: const AxisTitles(),
                rightTitles: const AxisTitles(),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 38,
                    interval: top / 4,
                    getTitlesWidget: (v, meta) => v == 0 || v >= top
                        ? const SizedBox.shrink()
                        : Text(
                            v.round().toString(),
                            style: const TextStyle(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.inkFaint,
                            ),
                          ),
                  ),
                ),
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 22,
                    getTitlesWidget: (v, meta) {
                      final i = v.toInt();
                      if (i < 0 || i >= shown.length) return const SizedBox.shrink();
                      return Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          shown[i].shortLabel,
                          style: const TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.inkFaint,
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
              barGroups: [
                for (var i = 0; i < shown.length; i++)
                  BarChartGroupData(
                    x: i,
                    barRods: [
                      BarChartRodData(
                        toY: shown[i].monthKg,
                        width: shown.length > 8 ? 14 : 20,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(5)),
                        rodStackItems: _stack(shown[i]),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Stacks the four groups. A row whose parts do not add up to its total (a
  /// rounding difference, or a damaged row) still draws a full-height bar.
  List<BarChartRodStackItem> _stack(FootprintEntry e) {
    final parts = nonEmptyGroups({
      'electricity': e.electricityKg,
      'cooking': e.cookingKg,
      'transport': e.transportKg,
      'air': e.airKg,
    });
    final sum = parts.fold<double>(0, (s, p) => s + p.value);
    if (sum <= 0) {
      return [BarChartRodStackItem(0, e.monthKg, AppColors.inkFaint)];
    }
    final scale = e.monthKg / sum;
    var from = 0.0;
    final items = <BarChartRodStackItem>[];
    for (final p in parts) {
      final to = from + p.value * scale;
      items.add(BarChartRodStackItem(from, to, groupColor(p.key)));
      from = to;
    }
    return items;
  }
}
