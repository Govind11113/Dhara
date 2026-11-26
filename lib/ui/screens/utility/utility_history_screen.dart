import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../data/models/utility.dart';
import '../../../state/utility_controller.dart';
import '../../widgets/common.dart';
import 'utility_verify_screen.dart';
import 'utility_widgets.dart';

/// Every imported bill, newest billing period first.
///
/// With [pickFor] set, tapping an electricity bill returns it so the footprint
/// screen can fill itself from it. Bills already counted in a month are shown
/// but not offered again, so one bill cannot be added twice.
class UtilityHistoryScreen extends ConsumerWidget {
  const UtilityHistoryScreen({super.key, this.pickFor});

  /// The footprint month being filled in, when picking.
  final String? pickFor;

  static Future<UtilityReading?> push(
    BuildContext context, {
    String? pickFor,
  }) => Navigator.of(context).push<UtilityReading>(
    MaterialPageRoute(builder: (_) => UtilityHistoryScreen(pickFor: pickFor)),
  );

  bool _pickable(UtilityReading r) =>
      pickFor != null &&
      r.utilityType == UtilityType.electricity &&
      (r.appliedMonthKey == null || r.appliedMonthKey == pickFor);

  Future<void> _deleteAll(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete all utility data?'),
        content: const Text(
          'This removes every imported bill and verification record from Dhara. '
          'Footprint months you already saved keep their numbers.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await ref.read(utilityServiceProvider).deleteAll();
      ref.invalidate(utilityHistoryProvider);
      if (context.mounted) showSnack(context, 'Your utility data was deleted.');
    } catch (e) {
      if (context.mounted) {
        showSnack(context, friendlyMessage(e), isError: true);
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(utilityHistoryProvider);
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: Text(pickFor == null ? 'Consumption history' : 'Choose a bill'),
        actions: [
          if (pickFor == null)
            IconButton(
              tooltip: 'Delete all utility data',
              icon: const Icon(Icons.delete_outline_rounded),
              onPressed: () => _deleteAll(context, ref),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(utilityHistoryProvider),
        child: switch (history) {
          // A retry in progress shows progress, not the old error.
          AsyncValue(isLoading: true) => const Padding(
            padding: EdgeInsets.all(20),
            child: LoadingList(count: 3, height: 140),
          ),
          AsyncError(:final error) => ListView(
            children: [
              ErrorRetry(
                message:
                    'Your utility records could not be loaded. '
                    '${friendlyMessage(error)}',
                onRetry: () => ref.invalidate(utilityHistoryProvider),
              ),
            ],
          ),
          AsyncValue(:final value?) when value.isEmpty => ListView(
            children: [
              const SizedBox(height: 60),
              EmptyState(
                emoji: '\u{1F9FE}',
                title: 'No utility consumption records yet.',
                message:
                    'Add an electricity or gas bill and it will show here.',
                actionLabel: 'Add your first bill',
                onAction: pickFor == null
                    ? () => UtilityVerifyScreen.push(
                        context,
                        UtilityType.electricity,
                      ).then((_) => ref.invalidate(utilityHistoryProvider))
                    : null,
              ),
            ],
          ),
          AsyncValue(:final value?) => ListView.separated(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            itemCount: value.length,
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (context, i) {
              final r = value[i];
              final pickable = _pickable(r);
              return Opacity(
                opacity: pickFor == null || pickable ? 1 : 0.55,
                child: ReadingCard(
                  reading: r,
                  onTap: pickable ? () => Navigator.of(context).pop(r) : null,
                ),
              );
            },
          ),
          _ => const Padding(
            padding: EdgeInsets.all(20),
            child: LoadingList(count: 3, height: 140),
          ),
        },
      ),
    );
  }
}
