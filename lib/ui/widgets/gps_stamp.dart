import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/services/location.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/formatters.dart';
import '../../core/utils/haptics.dart';
import 'common.dart';

/// The full reading behind a location, laid out the way a GPS camera stamps a
/// photo.
///
/// Everything shown here is already being captured — the point of surfacing it
/// is that the user is about to have this recorded against their name, and a
/// coordinate they cannot see is a coordinate they cannot dispute. It is read
/// only; the fix comes from the GPS chip and nothing on screen edits it.
///
/// Fields that a device did not really measure are omitted rather than shown as
/// zero. A phone standing still reports heading 0, and many report altitude 0
/// when they have no altitude at all — printing those as facts would be
/// inventing data.
class GpsStampCard extends StatelessWidget {
  const GpsStampCard({super.key, required this.fix, this.title = 'GPS reading'});

  final LocationFix fix;
  final String title;

  /// Below this the reported course is noise. A stationary phone still emits a
  /// heading, it just does not mean anything.
  static const _movingMps = 0.6;

  @override
  Widget build(BuildContext context) {
    final moving = fix.speedMps > _movingMps;

    return DharaCard(
      color: AppColors.forestInk,
      // DharaCard's default border is a pale green tuned for white cards; on a
      // near-black one it reads as an outline drawn by mistake.
      border: false,
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.my_location_rounded,
                size: 15,
                color: AppColors.lime,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                    color: AppColors.lime,
                  ),
                ),
              ),
              _CopyButton(fix: fix),
            ],
          ),
          const SizedBox(height: 13),

          // Degrees/minutes/seconds first because that is the notation a GPS
          // receiver and a camera stamp both use, with the decimal form under it
          // since that is what actually gets submitted and what a map accepts.
          _Coordinate(dms: fix.latDms, decimal: fix.lat),
          const SizedBox(height: 7),
          _Coordinate(dms: fix.lngDms, decimal: fix.lng),

          const SizedBox(height: 13),
          const Divider(height: 1, color: Colors.white12),
          const SizedBox(height: 12),

          if (fix.address case final address?)
            _StampRow(
              icon: Icons.place_outlined,
              label: 'Place',
              value: address,
            ),

          if (fix.capturedAt case final at?)
            _StampRow(
              icon: Icons.schedule_rounded,
              label: 'Captured',
              value: Fmt.stamp(at),
            ),

          _StampRow(
            icon: Icons.gps_fixed_rounded,
            label: 'Accuracy',
            value: '\u00B1${fix.accuracyM.toStringAsFixed(1)} m'
                '${fix.samples > 1 ? '  \u00B7  best of ${fix.samples}' : ''}',
          ),

          if (fix.hasAltitude)
            _StampRow(
              icon: Icons.terrain_rounded,
              label: 'Altitude',
              value: '${fix.altitudeM.toStringAsFixed(1)} m'
                  '${fix.altitudeAccuracyM > 0 ? ' \u00B1${fix.altitudeAccuracyM.toStringAsFixed(0)} m' : ''}',
            ),

          if (moving)
            _StampRow(
              icon: Icons.explore_outlined,
              label: 'Course',
              value: '${fix.headingDeg.round()}\u00B0 '
                  '${_compass(fix.headingDeg)}  \u00B7  '
                  '${(fix.speedMps * 3.6).toStringAsFixed(1)} km/h',
            ),

          _StampRow(
            icon: Icons.public_rounded,
            label: 'Datum',
            value: 'WGS-84',
            last: true,
          ),
        ],
      ),
    ).animate().fadeIn(duration: 250.ms);
  }

  static String _compass(double deg) {
    const points = [
      'N',
      'NE',
      'E',
      'SE',
      'S',
      'SW',
      'W',
      'NW',
    ];
    final normalised = (deg % 360 + 360) % 360;
    return points[((normalised + 22.5) ~/ 45) % 8];
  }
}

/// One coordinate, DMS over decimal.
class _Coordinate extends StatelessWidget {
  const _Coordinate({required this.dms, required this.decimal});

  final String dms;
  final double decimal;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Text(
            dms,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              height: 1.1,
              // Tabular figures so the two lines align digit for digit and the
              // numbers do not jitter as a live fix updates.
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          decimal.toStringAsFixed(6),
          style: const TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w600,
            color: Colors.white54,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

class _StampRow extends StatelessWidget {
  const _StampRow({
    required this.icon,
    required this.label,
    required this.value,
    this.last = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: last ? 0 : 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 13, color: Colors.white38),
          const SizedBox(width: 9),
          SizedBox(
            width: 62,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: Colors.white38,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.35,
                fontWeight: FontWeight.w700,
                color: Colors.white,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Puts the reading on the clipboard.
///
/// Decimal, comma separated, because that is the one form every maps app and
/// spreadsheet accepts — DMS is for reading, not for pasting.
class _CopyButton extends StatelessWidget {
  const _CopyButton({required this.fix});

  final LocationFix fix;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: () async {
        Haptics.tap();
        await Clipboard.setData(
          ClipboardData(
            text: '${fix.lat.toStringAsFixed(6)}, '
                '${fix.lng.toStringAsFixed(6)}',
          ),
        );
        if (context.mounted) showSnack(context, 'Coordinates copied');
      },
      child: const Padding(
        padding: EdgeInsets.all(4),
        child: Icon(Icons.copy_rounded, size: 15, color: Colors.white38),
      ),
    );
  }
}
