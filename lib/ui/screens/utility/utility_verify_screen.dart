import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/utility.dart';
import '../../../state/utility_controller.dart';
import '../../widgets/common.dart';
import 'utility_upload_screen.dart';

/// Choose an electricity or gas provider and enter the account number, then
/// continue to bill upload or manual entry.
///
/// This build has no automatic bill fetching. Returns the imported
/// [UtilityReading] when the user chooses to use it in their footprint,
/// otherwise null.
class UtilityVerifyScreen extends ConsumerStatefulWidget {
  const UtilityVerifyScreen({super.key, required this.type});

  final UtilityType type;

  static Future<UtilityReading?> push(BuildContext context, UtilityType type) =>
      Navigator.of(context).push<UtilityReading>(
        MaterialPageRoute(builder: (_) => UtilityVerifyScreen(type: type)),
      );

  @override
  ConsumerState<UtilityVerifyScreen> createState() =>
      _UtilityVerifyScreenState();
}

class _UtilityVerifyScreenState extends ConsumerState<UtilityVerifyScreen> {
  final _form = GlobalKey<FormState>();
  final _account = TextEditingController();

  UtilityProvider? _provider;

  bool get _isGas => widget.type == UtilityType.png;

  @override
  void dispose() {
    _account.dispose();
    super.dispose();
  }

  Future<void> _next(UtilityProvider provider) async {
    if (!(_form.currentState?.validate() ?? false)) return;
    Haptics.tap();
    final reading = await UtilityUploadScreen.push(
      context,
      type: widget.type,
      provider: provider,
      account: _account.text,
    );
    if (reading != null && mounted) Navigator.of(context).pop(reading);
  }

  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(utilityCatalogProvider);
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: Text(
          _isGas ? 'Verify Gas Connection' : 'Verify Electricity Connection',
        ),
      ),
      body: SafeArea(
        child: switch (catalog) {
          AsyncValue(isLoading: true) => const Padding(
            padding: EdgeInsets.all(20),
            child: LoadingList(count: 3, height: 64),
          ),
          AsyncError(:final error) => ErrorRetry(
            message:
                'Provider information could not be loaded. '
                '${friendlyMessage(error)}',
            onRetry: () => ref.invalidate(utilityCatalogProvider),
          ),
          AsyncValue(:final value?) => _formView(value),
          _ => const Padding(
            padding: EdgeInsets.all(20),
            child: LoadingList(count: 3, height: 64),
          ),
        },
      ),
    );
  }

  Widget _formView(UtilityCatalog catalog) {
    final region = catalog.regions.isEmpty ? null : catalog.regions.first;
    final state = region?.states.isEmpty ?? true ? null : region!.states.first;
    final providers = catalog.forType(widget.type, state: state?.code);
    final provider = _provider != null && providers.contains(_provider)
        ? _provider
        : null;

    return Form(
      key: _form,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Text(
            _isGas
                ? 'Add your household gas consumption from your bill to '
                      'calculate its carbon footprint.'
                : 'Add your electricity consumption from your bill to '
                      'calculate your carbon footprint.',
            style: const TextStyle(
              fontSize: 13,
              height: 1.45,
              fontWeight: FontWeight.w500,
              color: AppColors.inkSoft,
            ),
          ),
          const SizedBox(height: 14),
          _Notice(
            key: const Key('utility-manual-notice'),
            text: [
              if (!catalog.fromServer) ?catalog.serverProblem,
              'Automatic bill fetching is not configured yet. You can upload '
                  'your bill or enter consumption manually.',
            ].join('\n\n'),
          ),
          const SizedBox(height: 20),
          // One country and one state today. Shown, not hidden, so the user
          // knows where the provider list comes from.
          DropdownButtonFormField<String>(
            initialValue: region?.country,
            decoration: const InputDecoration(
              labelText: 'Country',
              prefixIcon: Icon(Icons.public_rounded),
            ),
            items: [
              for (final r in catalog.regions)
                DropdownMenuItem(value: r.country, child: Text(r.countryName)),
            ],
            onChanged: null,
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: state?.code,
            decoration: const InputDecoration(
              labelText: 'State',
              prefixIcon: Icon(Icons.map_outlined),
            ),
            items: [
              for (final s
                  in region?.states ?? const <({String code, String name})>[])
                DropdownMenuItem(value: s.code, child: Text(s.name)),
            ],
            onChanged: null,
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<UtilityProvider>(
            key: const Key('utility-provider'),
            initialValue: provider,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: _isGas ? 'Gas provider' : 'Electricity provider',
              prefixIcon: Icon(
                _isGas
                    ? Icons.local_fire_department_rounded
                    : Icons.bolt_rounded,
              ),
            ),
            items: [
              for (final p in providers)
                DropdownMenuItem(
                  value: p,
                  child: Text(
                    p.serviceAreas.isEmpty
                        ? p.name
                        : '${p.name} \u00B7 ${p.serviceAreas.join(', ')}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            validator: (p) => p == null ? 'Choose your provider' : null,
            onChanged: (p) {
              Haptics.select();
              setState(() => _provider = p);
            },
          ),
          if (provider != null) ...[
            const SizedBox(height: 14),
            TextFormField(
              key: const Key('utility-account'),
              controller: _account,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9\- ]')),
                LengthLimitingTextInputFormatter(24),
              ],
              decoration: InputDecoration(
                labelText: provider.accountLabel,
                helperText: provider.accountHelp,
                helperMaxLines: 3,
                prefixIcon: const Icon(Icons.pin_rounded),
              ),
              validator: provider.validateAccount,
            ),
          ],
          const SizedBox(height: 24),
          FilledButton(
            key: const Key('utility-next'),
            onPressed: provider == null ? null : () => _next(provider),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            child: const Text('Upload your bill'),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.amber.withValues(alpha: 0.10),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 12.5,
        height: 1.5,
        fontWeight: FontWeight.w600,
        color: AppColors.ink,
      ),
    ),
  );
}
