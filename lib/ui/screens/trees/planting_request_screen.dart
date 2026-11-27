import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/location.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/planting_request.dart';
import '../../../state/planting_controller.dart';
import '../../widgets/common.dart';
import 'planting_requests_screen.dart' show formatPlantingDay;

/// Asks the partner NGO for a place to plant.
///
/// The NGO needs to find the person, so a place is required: either a GPS pin
/// or a typed address. A pin is not demanded because many people would rather
/// type their area than switch location on.
class PlantingRequestScreen extends ConsumerStatefulWidget {
  const PlantingRequestScreen({super.key});

  static Future<void> push(BuildContext context) {
    Haptics.press();
    return Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const PlantingRequestScreen()),
    );
  }

  @override
  ConsumerState<PlantingRequestScreen> createState() =>
      _PlantingRequestScreenState();
}

class _PlantingRequestScreenState extends ConsumerState<PlantingRequestScreen> {
  final _address = TextEditingController();
  final _note = TextEditingController();

  double? _lat;
  double? _lng;
  double? _accuracyM;
  DateTime? _from;
  DateTime? _to;

  bool _locating = false;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _address.addListener(_changed);
  }

  @override
  void dispose() {
    _address.removeListener(_changed);
    _address.dispose();
    _note.dispose();
    super.dispose();
  }

  void _changed() => setState(() {});

  String? get _problem => planningProblem(
        lat: _lat,
        lng: _lng,
        address: _address.text,
        from: _from,
        to: _to,
      );

  bool get _canSend => _problem == null && !_sending && !_locating;

  Future<void> _useMyLocation() async {
    Haptics.press();
    setState(() => _locating = true);
    try {
      // Looser than a tree check-in: the NGO only needs to know the area, and a
      // 50 m reading arrives quickly where a 15 m one may never come indoors.
      final fix = await ref.read(locationServiceProvider).bestFix(
            targetAccuracyM: 50,
            maxSamples: 3,
            budget: const Duration(seconds: 12),
            resolveAddress: true,
          );
      if (!mounted) return;
      setState(() {
        _lat = fix.lat;
        _lng = fix.lng;
        _accuracyM = fix.accuracyM;
        // Only fills an empty box, so it never overwrites what they typed.
        if (_address.text.trim().isEmpty && fix.address != null) {
          _address.text = fix.address!;
        }
      });
    } on LocationFailure catch (e) {
      if (!mounted) return;
      showSnack(context, e.message, isError: true);
    } catch (_) {
      if (!mounted) return;
      showSnack(
        context,
        'Could not read your location. You can type an address instead.',
        isError: true,
      );
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _clearPin() => setState(() {
        _lat = null;
        _lng = null;
        _accuracyM = null;
      });

  Future<void> _pickDate({required bool isFrom}) async {
    Haptics.select();
    final today = DateTime.now();
    final first = DateTime(today.year, today.month, today.day);
    final current = isFrom ? _from : _to;

    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? (isFrom ? first : (_from ?? first)),
      firstDate: first,
      lastDate: first.add(const Duration(days: 365)),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isFrom) {
        _from = picked;
        // Keep the range sensible instead of leaving an end before the start.
        if (_to != null && _to!.isBefore(picked)) _to = picked;
      } else {
        _to = picked;
      }
    });
  }

  Future<void> _send() async {
    if (!_canSend) return;
    setState(() => _sending = true);
    try {
      await ref.read(plantingControllerProvider.notifier).create(
            lat: _lat,
            lng: _lng,
            addressLabel: _address.text.trim(),
            note: _note.text.trim(),
            preferredFrom: _from,
            // The end of the chosen day, so "by Friday" includes Friday.
            preferredTo: _to == null
                ? null
                : DateTime(_to!.year, _to!.month, _to!.day, 23, 59),
          );
      if (!mounted) return;
      Haptics.success();
      Navigator.of(context).pop();
      showSnack(context, 'Sent. The NGO will reply with a place and time.');
    } catch (e) {
      if (!mounted) return;
      Haptics.error();
      setState(() => _sending = false);
      showSnack(context, friendlyMessage(e), isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasPin = _lat != null && _lng != null;
    final busy = _sending;

    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: const Text('Request a place'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: busy
              ? null
              : () {
                  Haptics.tap();
                  Navigator.of(context).pop();
                },
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            Text(
              'Where would you like to plant?',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: AppColors.forest,
                  ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Tell the NGO where you are. They will reply with a planting '
              'site, a date and time, and where to meet.',
              style: TextStyle(
                fontSize: 13,
                height: 1.45,
                fontWeight: FontWeight.w500,
                color: AppColors.inkSoft,
              ),
            ),
            const SizedBox(height: 22),

            if (!hasPin)
              OutlinedButton.icon(
                onPressed: busy || _locating ? null : _useMyLocation,
                icon: _locating
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.my_location_rounded, size: 18),
                label: Text(_locating ? 'Finding you\u2026' : 'Use my location'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
              )
            else
              DharaCard(
                color: AppColors.limeSoft,
                padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
                child: Row(
                  children: [
                    const Icon(
                      Icons.check_circle_rounded,
                      size: 19,
                      color: AppColors.green,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _accuracyM == null
                            ? 'Location pinned'
                            : 'Location pinned \u00B7 within '
                                '${_accuracyM!.round()} m',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.forest,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: busy ? null : _clearPin,
                      child: const Text('Remove'),
                    ),
                  ],
                ),
              ),

            const SizedBox(height: 14),
            TextField(
              controller: _address,
              enabled: !busy,
              maxLength: 256,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Area or address',
                hintText: 'For example: Indiranagar, Bengaluru',
              ),
            ),

            const SizedBox(height: 8),
            const Text(
              'When suits you? (optional)',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: AppColors.forest,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: _DateButton(
                    label: 'From',
                    value: _from,
                    onTap: busy ? null : () => _pickDate(isFrom: true),
                    onClear: busy || _from == null
                        ? null
                        : () => setState(() => _from = null),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _DateButton(
                    label: 'Until',
                    value: _to,
                    onTap: busy ? null : () => _pickDate(isFrom: false),
                    onClear: busy || _to == null
                        ? null
                        : () => setState(() => _to = null),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 14),
            TextField(
              controller: _note,
              enabled: !busy,
              minLines: 3,
              maxLines: 5,
              maxLength: 500,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Anything the NGO should know? (optional)',
                alignLabelWithHint: true,
                hintText: 'How many trees, what space you have, who is coming',
              ),
            ),

            if (_problem != null && _addressTouched) ...[
              const SizedBox(height: 4),
              Text(
                _problem!,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.danger,
                ),
              ),
            ],

            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _canSend ? _send : null,
              icon: _sending
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_rounded, size: 18),
              label: Text(_sending ? 'Sending\u2026' : 'Send request'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Your name and the place you share are visible to the NGO team.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                height: 1.4,
                fontWeight: FontWeight.w600,
                color: AppColors.inkFaint,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// A hint about the missing place only once they have started on the form, so
  /// a fresh screen does not open with an error on it.
  bool get _addressTouched =>
      _address.text.isNotEmpty || _lat != null || _from != null || _to != null;
}

class _DateButton extends StatelessWidget {
  const _DateButton({
    required this.label,
    required this.value,
    required this.onTap,
    required this.onClear,
  });

  final String label;
  final DateTime? value;
  final VoidCallback? onTap;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        padding: const EdgeInsets.symmetric(horizontal: 12),
      ),
      child: Row(
        children: [
          const Icon(Icons.event_rounded, size: 17),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              value == null ? label : '$label ${formatPlantingDay(value!)}',
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12.5),
            ),
          ),
          if (onClear != null)
            GestureDetector(
              onTap: onClear,
              child: const Padding(
                padding: EdgeInsets.only(left: 4),
                child: Icon(Icons.close_rounded, size: 16),
              ),
            ),
        ],
      ),
    );
  }
}
