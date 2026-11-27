import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/planting_request.dart';
import '../../../state/planting_controller.dart';
import '../../widgets/common.dart';
import 'plant_tree_screen.dart';
import 'planting_requests_screen.dart'
    show formatPlantingDay, formatPlantingSlot, plantingStatusStyle;

/// One planting request: what was asked, and what the NGO answered.
///
/// Reads the request from the shared list by id rather than taking a copy, so
/// the screen updates in place when the member confirms or cancels.
class PlantingDetailScreen extends ConsumerStatefulWidget {
  const PlantingDetailScreen({super.key, required this.requestId});

  final String requestId;

  static Future<void> push(BuildContext context, String requestId) {
    Haptics.tap();
    return Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => PlantingDetailScreen(requestId: requestId),
      ),
    );
  }

  @override
  ConsumerState<PlantingDetailScreen> createState() =>
      _PlantingDetailScreenState();
}

class _PlantingDetailScreenState extends ConsumerState<PlantingDetailScreen> {
  bool _busy = false;

  Future<bool> _ask({
    required String title,
    required String body,
    required String confirm,
    String cancel = 'Keep it',
  }) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirm),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _run(
    Future<PlantingRequest> Function() action,
    String done,
  ) async {
    setState(() => _busy = true);
    try {
      await action();
      if (!mounted) return;
      Haptics.success();
      showSnack(context, done);
    } catch (e) {
      if (!mounted) return;
      Haptics.error();
      showSnack(context, friendlyMessage(e), isError: true);
      // The server may know something this screen does not (the NGO changed the
      // slot while it was open), so show the current truth after a refusal.
      await ref.read(plantingControllerProvider.notifier).refresh();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept() => _run(
        () => ref
            .read(plantingControllerProvider.notifier)
            .respond(widget.requestId, accept: true),
        'Confirmed. See you there!',
      );

  Future<void> _decline() async {
    final ok = await _ask(
      title: 'Cannot make this time?',
      body: 'The NGO will be asked to suggest another time.',
      confirm: 'Decline this time',
      cancel: 'Go back',
    );
    if (!ok) return;
    await _run(
      () => ref
          .read(plantingControllerProvider.notifier)
          .respond(widget.requestId, accept: false),
      'Thanks. The NGO will suggest another time.',
    );
  }

  Future<void> _cancel() async {
    final ok = await _ask(
      title: 'Cancel this request?',
      body: 'The NGO will no longer plan a planting for you.',
      confirm: 'Cancel request',
    );
    if (!ok) return;
    await _run(
      () => ref.read(plantingControllerProvider.notifier).cancel(widget.requestId),
      'Request cancelled.',
    );
  }

  Future<void> _openMap(double lat, double lng) async {
    Haptics.tap();
    final uri = Uri.https('www.google.com', '/maps/search/', {
      'api': '1',
      'query': '$lat,$lng',
    });
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (!opened && mounted) {
      showSnack(context, 'Could not open maps. The address is shown above.', isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = ref.watch(plantingControllerProvider).value ?? const [];
    final request = list.where((r) => r.id == widget.requestId).firstOrNull;

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: const Text('Planting request'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () {
            Haptics.tap();
            Navigator.of(context).pop();
          },
        ),
      ),
      body: SafeArea(
        child: request == null
            ? const EmptyState(
                emoji: '\u{1F50D}',
                title: 'Request not found',
                message: 'It may have been removed. Go back and pull to refresh.',
              )
            : _body(context, request),
      ),
    );
  }

  Widget _body(BuildContext context, PlantingRequest r) {
    final style = plantingStatusStyle(r.status);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            StatusPill(label: r.status.label, color: style.color, icon: style.icon),
            Text(
              'Sent ${formatPlantingDay(r.createdAt)}',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.inkFaint,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),

        if (r.hasReply) ...[
          _Section(
            title: 'Your planting plan',
            children: [
              _Fact(
                icon: Icons.park_rounded,
                label: 'Planting site',
                value: r.siteAddress,
              ),
              _Fact(
                icon: Icons.event_rounded,
                label: 'When',
                value: formatPlantingSlot(r.meetingAt!),
              ),
              _Fact(
                icon: Icons.flag_rounded,
                label: 'Meet at',
                value: r.meetingPoint,
              ),
              if (r.replyNotes.trim().isNotEmpty)
                _Fact(
                  icon: Icons.notes_rounded,
                  label: 'From the NGO',
                  value: r.replyNotes,
                ),
              if (r.hasSitePin) ...[
                const SizedBox(height: 4),
                OutlinedButton.icon(
                  onPressed: () => _openMap(r.siteLat!, r.siteLng!),
                  icon: const Icon(Icons.map_outlined, size: 18),
                  label: const Text('Open the site in maps'),
                ),
              ],
            ],
          ),
          const SizedBox(height: 14),
        ],

        ..._actions(r),

        _Section(
          title: 'What you asked for',
          children: [
            _Fact(
              icon: Icons.place_rounded,
              label: 'Your place',
              value: r.addressLabel.trim().isNotEmpty
                  ? r.addressLabel
                  : (r.hasPin ? 'A map pin you shared' : '\u2014'),
            ),
            _Fact(
              icon: Icons.date_range_rounded,
              label: 'Your dates',
              value: _preferred(r),
            ),
            if (r.note.trim().isNotEmpty)
              _Fact(icon: Icons.notes_rounded, label: 'Your note', value: r.note),
          ],
        ),

        if (r.canCancel) ...[
          const SizedBox(height: 10),
          TextButton(
            onPressed: _busy ? null : _cancel,
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('Cancel this request'),
          ),
        ],
      ],
    );
  }

  List<Widget> _actions(PlantingRequest r) {
    switch (r.status) {
      case PlantingStatus.scheduled:
        return [
          FilledButton.icon(
            onPressed: _busy ? null : _accept,
            icon: const Icon(Icons.check_rounded, size: 18),
            label: const Text("I'll be there"),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: _busy ? null : _decline,
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
            child: const Text("I can't make this time"),
          ),
          const SizedBox(height: 18),
        ];
      case PlantingStatus.declined:
        return [
          const _Note(
            'You said this time does not work. The NGO has been asked to '
            'suggest another one.',
          ),
          const SizedBox(height: 14),
        ];
      case PlantingStatus.open:
        return [
          const _Note(
            'The NGO has your request. You will see a place and a time here '
            'once they reply.',
          ),
          const SizedBox(height: 14),
        ];
      case PlantingStatus.confirmed:
        return [
          const _Note('You are confirmed. The NGO is expecting you.'),
          const SizedBox(height: 14),
        ];
      case PlantingStatus.completed:
        return [
          const _Note(
            'Thank you for planting! Register your tree in the app to start '
            'earning credits.',
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: () => PlantTreeScreen.push(context),
            icon: const Icon(Icons.eco_rounded, size: 18),
            label: const Text('Register your tree'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          ),
          const SizedBox(height: 18),
        ];
      case PlantingStatus.cancelled:
        return const [];
    }
  }

  String _preferred(PlantingRequest r) {
    final from = r.preferredFrom;
    final to = r.preferredTo;
    if (from != null && to != null) {
      return '${formatPlantingDay(from)} to ${formatPlantingDay(to)}';
    }
    if (from != null) return 'From ${formatPlantingDay(from)}';
    if (to != null) return 'By ${formatPlantingDay(to)}';
    return 'No preference';
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return DharaCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.forest,
            ),
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppColors.green),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.inkFaint,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.35,
                    fontWeight: FontWeight.w700,
                    color: AppColors.forest,
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

class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return DharaCard(
      color: AppColors.limeSoft,
      padding: const EdgeInsets.all(14),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 13,
          height: 1.45,
          fontWeight: FontWeight.w600,
          color: AppColors.forest,
        ),
      ),
    );
  }
}
