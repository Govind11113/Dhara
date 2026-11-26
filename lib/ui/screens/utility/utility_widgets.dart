import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../data/models/utility.dart';
import '../../widgets/common.dart';

/// The consent text shown before any account is used. Fixed wording, so the
/// version the server records always matches what was on screen.
String consentText(UtilityType type) => type == UtilityType.png
    ? 'Dhara will store the gas bill details you provide (account number, '
          'consumption and billing period) to calculate your carbon footprint. '
          'Your full account number is not stored, only its last four digits. '
          'Your information is used only for the purposes described in our '
          'privacy policy.'
    : 'Dhara will store the electricity bill details you provide (account '
          'number, consumption and billing period) to calculate your carbon '
          'footprint. Your full account number is not stored, only its last '
          'four digits. Your information is used only for the purposes '
          'described in our privacy policy.';

Color statusColor(UtilityStatus s) => switch (s) {
  UtilityStatus.verified => AppColors.green,
  UtilityStatus.documentReview ||
  UtilityStatus.unverified ||
  UtilityStatus.duplicate => AppColors.amber,
  UtilityStatus.pending || UtilityStatus.fetching => AppColors.info,
  _ => AppColors.danger,
};

String formatQuantity(double v) => v == v.roundToDouble()
    ? v.round().toString()
    : v.toStringAsFixed(2).replaceFirst(RegExp(r'0+$'), '');

String formatPeriod(UtilityReading r) {
  final f = DateFormat('d MMM yyyy');
  return '${f.format(r.periodStart)} \u2013 ${f.format(r.periodEnd)}';
}

/// One imported bill: what it says and how far it can be trusted.
class ReadingCard extends StatelessWidget {
  const ReadingCard({
    super.key,
    required this.reading,
    this.onTap,
    this.trailing,
  });

  final UtilityReading reading;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final r = reading;
    return DharaCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                r.utilityType == UtilityType.png
                    ? Icons.local_fire_department_rounded
                    : Icons.bolt_rounded,
                color: AppColors.green,
                size: 20,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  r.providerName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.forest,
                  ),
                ),
              ),
              StatusPill(
                label: r.status.label,
                color: statusColor(r.status),
                compact: true,
              ),
            ],
          ),
          const SizedBox(height: 10),
          _Line('Account', r.accountMasked),
          _Line('Billing period', formatPeriod(r)),
          _Line(
            'Consumption',
            '${formatQuantity(r.consumptionValue)} ${r.consumptionUnit}',
          ),
          if (r.billAmount != null)
            _Line('Bill amount', '\u20B9${r.billAmount!.toStringAsFixed(2)}'),
          _Line(
            'Carbon',
            r.carbonPending || r.carbonKg == null
                ? 'Calculation pending'
                : '${formatQuantity(r.carbonKg!)} kg CO\u2082',
          ),
          if (r.appliedMonthKey != null)
            _Line('Counted in', r.appliedMonthKey!),
          const SizedBox(height: 6),
          Text(
            sourceLabel(r.status),
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
              color: AppColors.inkFaint,
            ),
          ),
          if (r.carbonPending)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text(
                'No verified emission factor for piped gas is on file yet, so its '
                'carbon is not calculated. The consumption is saved.',
                style: TextStyle(
                  fontSize: 11.5,
                  height: 1.4,
                  color: AppColors.inkSoft,
                ),
              ),
            ),
          ?trailing,
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 112,
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 12.5,
              color: AppColors.inkSoft,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.forest,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
}
