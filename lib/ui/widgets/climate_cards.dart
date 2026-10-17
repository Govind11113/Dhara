import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/air_quality.dart';
import '../../core/services/location.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/haptics.dart';
import '../../core/utils/tree_co2.dart';
import '../../data/models/footprint.dart';
import '../../state/air_controller.dart';
import '../../state/footprint_controller.dart';
import '../../state/trees_controller.dart';
import '../screens/footprint/footprint_screen.dart';
import 'common.dart';

/// The EPA's own colours for each AQI category, so the card reads the same as
/// every other air quality display the user has seen.
Color bandColor(AirBand band) => switch (band) {
      AirBand.good => AppColors.greenBright,
      AirBand.moderate => const Color(0xFFD9A400),
      AirBand.sensitive => const Color(0xFFE8833A),
      AirBand.unhealthy => AppColors.danger,
      AirBand.veryUnhealthy => const Color(0xFF8E44AD),
      AirBand.hazardous => const Color(0xFF7E0023),
    };

/// Live air quality and CO\u2082 for where the user is.
///
/// Four states, each with something to do: loading, no location yet (a button,
/// never a surprise permission dialog), the service unreachable (a retry), and
/// the reading itself.
class AirQualityCard extends ConsumerWidget {
  const AirQualityCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final air = ref.watch(airQualityProvider);

    final Widget body = air.when(
      loading: () => const LoadingList(count: 1, height: 150),
      error: (error, _) => _Unavailable(
        message: error is AirQualityException
            ? error.message
            : 'Could not load air quality.',
        onRetry: () => ref.invalidate(airQualityProvider),
      ),
      data: (reading) => reading == null
          ? _NeedsLocation(onEnable: () => _enable(context, ref))
          : _Reading(air: reading),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Air around you'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: body,
        ),
      ],
    ).animate().fadeIn();
  }

  Future<void> _enable(BuildContext context, WidgetRef ref) async {
    Haptics.press();
    final location = ref.read(locationServiceProvider);
    try {
      await location.ensureReady();
    } on LocationFailure catch (e) {
      if (!context.mounted) return;
      showSnack(context, e.message, isError: true);
      // Nothing more can be done in-app for these two; take them to the switch.
      if (e.problem == LocationProblem.permissionDeniedForever) {
        await location.openSettings();
      } else if (e.problem == LocationProblem.serviceDisabled) {
        await location.openLocationSettings();
      }
      return;
    }
    ref.invalidate(passiveLocationProvider);
    ref.invalidate(airQualityProvider);
  }
}

class _NeedsLocation extends StatelessWidget {
  const _NeedsLocation({required this.onEnable});

  final VoidCallback onEnable;

  @override
  Widget build(BuildContext context) {
    return DharaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'See the air quality and CO\u2082 where you are.',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.forest,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Dhara only needs your rough area for this \u2014 it is rounded to '
            'about 11 km before it is sent to the weather service.',
            style: TextStyle(
              fontSize: 12.5,
              height: 1.45,
              fontWeight: FontWeight.w500,
              color: AppColors.inkSoft,
            ),
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: onEnable,
            icon: const Icon(Icons.my_location_rounded, size: 18),
            label: const Text('Allow location'),
          ),
        ],
      ),
    );
  }
}

class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return DharaCard(
      child: Row(
        children: [
          const Icon(Icons.cloud_off_rounded, size: 22, color: AppColors.inkFaint),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.4,
                fontWeight: FontWeight.w600,
                color: AppColors.inkSoft,
              ),
            ),
          ),
          TextButton(
            onPressed: () {
              Haptics.tap();
              onRetry();
            },
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _Reading extends StatelessWidget {
  const _Reading({required this.air});

  final AirQuality air;

  @override
  Widget build(BuildContext context) {
    final band = air.band;
    final color = band == null ? AppColors.inkFaint : bandColor(band);

    final chips = <Widget>[
      if (air.co2Ppm != null)
        _Figure(
          label: 'CO\u2082',
          value: '${air.co2Ppm!.round()}',
          unit: 'ppm',
        ),
      if (air.pm25 != null)
        _Figure(label: 'PM2.5', value: air.pm25!.toStringAsFixed(0), unit: '\u00B5g/m\u00B3'),
      if (air.pm10 != null)
        _Figure(label: 'PM10', value: air.pm10!.toStringAsFixed(0), unit: '\u00B5g/m\u00B3'),
    ];

    return DharaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (band != null)
            Semantics(
              label: 'Air quality index ${air.usAqi}, ${band.label}',
              excludeSemantics: true,
              child: Row(
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.14),
                      shape: BoxShape.circle,
                      border: Border.all(color: color, width: 2.5),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      '${air.usAqi}',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: color,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          band.label,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                            color: color,
                          ),
                        ),
                        const SizedBox(height: 3),
                        const Text(
                          'US AQI',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: AppColors.inkFaint,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          if (band != null) ...[
            const SizedBox(height: 12),
            Text(
              band.advice,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.45,
                fontWeight: FontWeight.w500,
                color: AppColors.inkSoft,
              ),
            ),
          ],
          if (chips.isNotEmpty) ...[
            const SizedBox(height: 14),
            Wrap(spacing: 10, runSpacing: 10, children: chips),
          ],
          const SizedBox(height: 14),
          Text(
            [
              if (air.co2Ppm != null)
                'CO\u2082 is a regional model estimate, not a street-level sensor.',
              if (air.localTime != null) 'Updated ${air.localTime} local time.',
              'Air data: Open-Meteo.com (CC BY 4.0).',
            ].join(' '),
            style: const TextStyle(
              fontSize: 10.5,
              height: 1.4,
              fontWeight: FontWeight.w500,
              color: AppColors.inkFaint,
            ),
          ),
        ],
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, required this.unit});

  final String label;
  final String value;
  final String unit;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: AppColors.inkFaint,
            ),
          ),
          const SizedBox(height: 2),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: value,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                    color: AppColors.forest,
                  ),
                ),
                TextSpan(
                  text: ' $unit',
                  style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.inkSoft,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// How much CO\u2082 a typical tree takes in, and what the member's own trees
/// add up to.
///
/// Hidden until the species table has loaded: there is nothing honest to show
/// without it, and a made-up default would be worse than a gap.
class AverageTreeCard extends ConsumerWidget {
  const AverageTreeCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final species = ref.watch(speciesProvider).value;
    final trees = ref.watch(treesControllerProvider).value ?? const [];
    if (species == null) return const SizedBox.shrink();

    final co2 = computeTreeCo2(species, trees);
    if (co2 == null) return const SizedBox.shrink();

    final mine = co2.myLivingTrees == 0
        ? 'Plant a tree and your own count starts here.'
        : 'Your ${co2.myLivingTrees == 1 ? 'living tree' : '${co2.myLivingTrees} living trees'}'
            ' will take in about ${formatKg(co2.myKgPerYear)} a year once grown.';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'What a tree can do'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: DharaCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(
                        color: AppColors.limeSoft,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Center(
                        child: Text('\u{1F333}', style: TextStyle(fontSize: 23)),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'An average tree takes in about '
                            '${formatKg(co2.avgKgPerYear)} of CO\u2082 a year',
                            style: const TextStyle(
                              fontSize: 14.5,
                              height: 1.3,
                              fontWeight: FontWeight.w800,
                              color: AppColors.forest,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'That is roughly ${co2.avgGramsPerDay.round()} g every day.',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AppColors.inkSoft,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const Divider(height: 26, color: AppColors.outline),
                Text(
                  mine,
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.45,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 10),
                const Text(
                  'Typical figures for fully grown trees, averaged over the '
                  'species on Dhara. Young trees take in less while they grow.',
                  style: TextStyle(
                    fontSize: 10.5,
                    height: 1.4,
                    fontWeight: FontWeight.w500,
                    color: AppColors.inkFaint,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    ).animate().fadeIn();
  }
}


/// Entry to the carbon footprint calculator, showing the latest saved month and
/// whether it is going up or down.
class FootprintCard extends ConsumerWidget {
  const FootprintCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(footprintHistoryProvider);
    final entries = history.value ?? const <FootprintEntry>[];

    final Widget body = history.isLoading && !history.hasValue
        ? const LoadingList(count: 1, height: 96)
        : entries.isEmpty
            ? const _FootprintInvite()
            : _FootprintSummary(latest: entries.first, previous: entries.length > 1 ? entries[1] : null);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: 'Your carbon footprint'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: body,
        ),
      ],
    ).animate().fadeIn();
  }
}

class _FootprintInvite extends StatelessWidget {
  const _FootprintInvite();

  @override
  Widget build(BuildContext context) {
    return DharaCard(
      onTap: () => FootprintScreen.push(context),
      child: const Row(
        children: [
          Text('\u{1F463}', style: TextStyle(fontSize: 26)),
          SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Work out your footprint',
                  style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: AppColors.forest),
                ),
                SizedBox(height: 3),
                Text(
                  'Your electricity, cooking gas and travel, in about a minute.',
                  style: TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w600, color: AppColors.inkSoft),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right_rounded, color: AppColors.inkFaint),
        ],
      ),
    );
  }
}

class _FootprintSummary extends StatelessWidget {
  const _FootprintSummary({required this.latest, required this.previous});

  final FootprintEntry latest;
  final FootprintEntry? previous;

  /// Percentage change from the previous saved month, or null when there is
  /// nothing sensible to compare (no earlier month, or it was zero).
  static double? change(FootprintEntry latest, FootprintEntry? previous) {
    final p = previous?.monthKg;
    if (p == null || p <= 0) return null;
    return (latest.monthKg - p) / p * 100;
  }

  @override
  Widget build(BuildContext context) {
    final delta = change(latest, previous);
    // Lower is better here, so a fall is shown in green.
    final down = delta != null && delta < 0;
    final flat = delta != null && delta.abs() < 1;

    return DharaCard(
      onTap: () => FootprintScreen.push(context),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  latest.label,
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.inkFaint),
                ),
                const SizedBox(height: 2),
                Text.rich(TextSpan(children: [
                  TextSpan(
                    text: formatCo2(latest.monthKg),
                    style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppColors.forest),
                  ),
                  const TextSpan(
                    text: '  CO\u2082e',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.inkSoft),
                  ),
                ])),
                if (delta != null) ...[
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        flat
                            ? Icons.trending_flat_rounded
                            : down
                                ? Icons.trending_down_rounded
                                : Icons.trending_up_rounded,
                        size: 16,
                        color: flat ? AppColors.inkFaint : down ? AppColors.greenBright : AppColors.danger,
                      ),
                      const SizedBox(width: 5),
                      Text(
                        flat
                            ? 'About the same as ${previous!.label}'
                            : '${delta.abs().round()}% ${down ? 'lower' : 'higher'} than ${previous!.label}',
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded, color: AppColors.inkFaint),
        ],
      ),
    );
  }
}

/// Exposed for testing the month-on-month arithmetic.
double? footprintChange(FootprintEntry latest, FootprintEntry? previous) =>
    _FootprintSummary.change(latest, previous);
