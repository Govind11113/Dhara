import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/planting_request.dart';
import '../../../state/planting_controller.dart';
import '../../widgets/common.dart';
import 'planting_detail_screen.dart';
import 'planting_request_screen.dart';

/// Colour and icon per request status, shared by the list and detail screens.
({Color color, IconData icon}) plantingStatusStyle(PlantingStatus status) =>
    switch (status) {
      PlantingStatus.open => (
          color: AppColors.info,
          icon: Icons.hourglass_bottom_rounded,
        ),
      PlantingStatus.scheduled => (
          color: AppColors.amber,
          icon: Icons.event_available_rounded,
        ),
      PlantingStatus.confirmed => (
          color: AppColors.green,
          icon: Icons.check_circle_rounded,
        ),
      PlantingStatus.declined => (
          color: AppColors.amber,
          icon: Icons.hourglass_bottom_rounded,
        ),
      PlantingStatus.completed => (
          color: AppColors.green,
          icon: Icons.eco_rounded,
        ),
      PlantingStatus.cancelled => (
          color: AppColors.inkFaint,
          icon: Icons.close_rounded,
        ),
    };

/// "Sat, 5 Dec 2026 · 9:30 am". Local time, since that is when the person will
/// actually be standing there.
String formatPlantingSlot(DateTime when) =>
    DateFormat('EEE, d MMM y \u00B7 h:mm a').format(when);

String formatPlantingDay(DateTime when) => DateFormat('d MMM y').format(when);

/// Every request the member has made, and a way to make another.
class PlantingRequestsScreen extends ConsumerWidget {
  const PlantingRequestsScreen({super.key});

  static Future<void> push(BuildContext context) {
    Haptics.press();
    return Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const PlantingRequestsScreen()),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final requests = ref.watch(plantingControllerProvider);

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: const Text('Planting places'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () {
            Haptics.tap();
            Navigator.of(context).pop();
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => PlantingRequestScreen.push(context),
        backgroundColor: AppColors.green,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text(
          'Request a place',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(plantingControllerProvider.notifier).refresh(),
        color: AppColors.green,
        child: switch (requests) {
          AsyncError(:final error) when !requests.hasValue => ListView(
              children: [
                SizedBox(
                  height: 420,
                  child: ErrorRetry(
                    message: friendlyMessage(error),
                    onRetry: () => ref.invalidate(plantingControllerProvider),
                  ),
                ),
              ],
            ),
          AsyncValue(:final value?) when value.isEmpty => ListView(
              children: [
                SizedBox(
                  height: 460,
                  child: EmptyState(
                    emoji: '\u{1F331}',
                    title: 'No requests yet',
                    message:
                        'Not sure where to plant? Ask our partner NGO. They '
                        'will suggest a place and a time to meet.',
                    actionLabel: 'Request a place',
                    onAction: () => PlantingRequestScreen.push(context),
                  ),
                ),
              ],
            ),
          AsyncValue(:final value?) => ListView.separated(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 96),
              itemCount: value.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, i) => PlantingRequestCard(request: value[i])
                  .animate(delay: (45 * i).ms)
                  .fadeIn()
                  .slideY(begin: 0.1, end: 0),
            ),
          _ => const Padding(
              padding: EdgeInsets.only(top: 16),
              child: LoadingList(count: 3, height: 110),
            ),
        },
      ),
    );
  }
}

class PlantingRequestCard extends StatelessWidget {
  const PlantingRequestCard({super.key, required this.request});

  final PlantingRequest request;

  @override
  Widget build(BuildContext context) {
    final style = plantingStatusStyle(request.status);
    final place = request.addressLabel.trim().isNotEmpty
        ? request.addressLabel.trim()
        : 'Shared a map pin';

    return DharaCard(
      onTap: () => PlantingDetailScreen.push(context, request.id),
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  place,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.forest,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              StatusPill(
                label: request.status.label,
                color: style.color,
                icon: style.icon,
                compact: true,
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (request.hasReply)
            Text(
              '${formatPlantingSlot(request.meetingAt!)}\n'
              '${request.siteAddress}',
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.4,
                fontWeight: FontWeight.w600,
                color: AppColors.inkSoft,
              ),
            )
          else
            Text(
              'Sent ${formatPlantingDay(request.createdAt)}',
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppColors.inkSoft,
              ),
            ),
          if (request.needsAnswer) ...[
            const SizedBox(height: 10),
            const Text(
              'Tap to confirm or decline',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: AppColors.amber,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
