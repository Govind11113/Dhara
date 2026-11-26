import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/errors.dart';
import '../../../core/utils/haptics.dart';
import '../../../data/models/utility.dart';
import '../../../state/utility_controller.dart';
import '../../widgets/camera_capture.dart';
import '../../widgets/common.dart';
import 'utility_widgets.dart';

/// Where a bill comes from.
enum BillSource { camera, gallery, pdf }

/// Picks a bill and returns a local file path, or null if the user cancelled.
typedef BillPicker =
    Future<String?> Function(BuildContext context, BillSource source);

/// The fallback when the provider cannot be asked directly: upload a bill
/// (photo, gallery image or PDF), or type the figures in.
///
/// Whatever is saved here is never marked verified. A bill photo is held for
/// review; typed figures are unverified. The screen says which.
class UtilityUploadScreen extends ConsumerStatefulWidget {
  const UtilityUploadScreen({
    super.key,
    required this.type,
    required this.provider,
    required this.account,
    this.picker = defaultBillPicker,
  });

  final UtilityType type;
  final UtilityProvider provider;
  final String account;
  final BillPicker picker;

  static Future<UtilityReading?> push(
    BuildContext context, {
    required UtilityType type,
    required UtilityProvider provider,
    required String account,
  }) => Navigator.of(context).push<UtilityReading>(
    MaterialPageRoute(
      builder: (_) =>
          UtilityUploadScreen(type: type, provider: provider, account: account),
    ),
  );

  @override
  ConsumerState<UtilityUploadScreen> createState() =>
      _UtilityUploadScreenState();
}

class _UtilityUploadScreenState extends ConsumerState<UtilityUploadScreen> {
  final _form = GlobalKey<FormState>();
  final _consumption = TextEditingController();
  final _previous = TextEditingController();
  final _current = TextEditingController();

  DateTime? _start;
  DateTime? _end;

  String? _fileId;
  String? _fileName;
  String _ocrText = '';
  bool _reading = false;
  bool _submitting = false;
  bool _consented = false;
  bool _suggested = false;
  UtilityVerification? _result;

  final String _requestId = newRequestId();

  @override
  void dispose() {
    _consumption.dispose();
    _previous.dispose();
    _current.dispose();
    super.dispose();
  }

  Future<void> _pick(BillSource source) async {
    if (_reading || _submitting) return;
    final path = await widget.picker(context, source);
    if (path == null || !mounted) return;

    setState(() => _reading = true);
    try {
      final uploaded = await ref.read(billUploaderProvider).upload(path);
      ExtractedBill extracted = const ExtractedBill();
      if (uploaded.ocrText.trim().isNotEmpty) {
        extracted = await ref
            .read(utilityServiceProvider)
            .extract(type: widget.type, ocrText: uploaded.ocrText);
      }
      if (!mounted) return;
      setState(() {
        _fileId = uploaded.fileId;
        _fileName = path.split(Platform.pathSeparator).last;
        _ocrText = uploaded.ocrText;
        _suggested = _apply(extracted);
        _reading = false;
      });
    } catch (e) {
      if (!mounted) return;
      Haptics.error();
      setState(() => _reading = false);
      showSnack(context, friendlyMessage(e), isError: true);
    }
  }

  /// Fills empty fields from what was read. Never overwrites what the user typed.
  bool _apply(ExtractedBill e) {
    var any = false;
    void put(TextEditingController c, double? v) {
      if (v != null && c.text.trim().isEmpty) {
        c.text = formatQuantity(v);
        any = true;
      }
    }

    put(_consumption, e.consumptionValue);
    put(_previous, e.previousReading);
    put(_current, e.currentReading);
    if (_start == null && e.periodStart != null) {
      _start = e.periodStart;
      any = true;
    }
    if (_end == null && e.periodEnd != null) {
      _end = e.periodEnd;
      any = true;
    }
    return any;
  }

  Future<void> _pickDate(bool start) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
      initialDate: (start ? _start : _end) ?? now,
    );
    if (picked != null && mounted) {
      setState(() => start ? _start = picked : _end = picked);
    }
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    if (_start == null || _end == null) {
      showSnack(
        context,
        'Enter the billing period dates shown on your bill.',
        isError: true,
      );
      return;
    }
    if (!_consented) {
      showSnack(
        context,
        'Please read and accept how Dhara uses your account first.',
        isError: true,
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      // Usually already loaded by the screen before this one; read it fresh
      // otherwise rather than silently doing nothing.
      final catalog = await ref.read(utilityCatalogProvider.future);
      final result = await ref
          .read(utilityServiceProvider)
          .submitBill(
            type: widget.type,
            providerId: widget.provider.id,
            account: widget.account,
            requestId: _requestId,
            consentVersion: catalog.consentVersion,
            consumption: double.parse(_consumption.text.trim()),
            periodStart: _start!,
            periodEnd: _end!,
            billFileId: _fileId,
            ocrText: _ocrText,
            previousReading: double.tryParse(_previous.text.trim()),
            currentReading: double.tryParse(_current.text.trim()),
          );
      if (!mounted) return;
      Haptics.success();
      setState(() {
        _result = result;
        _submitting = false;
      });
    } catch (e) {
      if (!mounted) return;
      Haptics.error();
      setState(() => _submitting = false);
      showSnack(context, friendlyMessage(e), isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: Text(
          widget.type == UtilityType.png
              ? 'Upload gas bill'
              : 'Upload electricity bill',
        ),
      ),
      body: SafeArea(child: result == null ? _formView() : _resultView(result)),
    );
  }

  Widget _formView() {
    final unit = widget.type.unit;
    final date = DateFormat('d MMM yyyy');
    return Form(
      key: _form,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Text(
            '${widget.provider.name} \u00B7 ${widget.provider.accountLabel} '
            '${UtilityProvider.normalize(widget.account).isEmpty ? '' : '\u2022\u2022\u2022\u2022${_tail(widget.account)}'}',
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              color: AppColors.forest,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Add your bill, then check the figures. Figures from a bill are held for review '
            'and are not treated as verified.',
            style: TextStyle(
              fontSize: 12.5,
              height: 1.45,
              color: AppColors.inkSoft,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _SourceButton(
                key: const Key('bill-camera'),
                icon: Icons.photo_camera_rounded,
                label: 'Take photo',
                onTap: () => _pick(BillSource.camera),
              ),
              _SourceButton(
                key: const Key('bill-gallery'),
                icon: Icons.photo_library_rounded,
                label: 'Gallery',
                onTap: () => _pick(BillSource.gallery),
              ),
              _SourceButton(
                key: const Key('bill-pdf'),
                icon: Icons.picture_as_pdf_rounded,
                label: 'PDF',
                onTap: () => _pick(BillSource.pdf),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (_reading)
            const Row(
              children: [
                SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: 10),
                Text('Uploading and reading your bill\u2026'),
              ],
            )
          else if (_fileName != null)
            Text(
              _suggested
                  ? 'Attached $_fileName. Some figures were read from it \u2014 check them.'
                  : 'Attached $_fileName. Nothing could be read from it, so enter the figures below.',
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.inkSoft,
                fontWeight: FontWeight.w600,
              ),
            )
          else
            const Text(
              'No bill attached: the figures will be saved as entered by you (unverified).',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.inkSoft,
                fontWeight: FontWeight.w600,
              ),
            ),
          const SizedBox(height: 18),
          if (widget.type == UtilityType.png) ...[
            DropdownButtonFormField<String>(
              key: const Key('bill-unit'),
              initialValue: unit,
              decoration: const InputDecoration(
                labelText: 'Consumption unit',
                helperText:
                    'Dhara accepts gas readings in SCM (standard cubic metres), '
                    'the unit printed on PNG bills.',
                helperMaxLines: 2,
                prefixIcon: Icon(Icons.straighten_rounded),
              ),
              items: [
                DropdownMenuItem(
                  value: unit,
                  child: const Text('SCM (standard cubic metres)'),
                ),
              ],
              onChanged: (_) {},
            ),
            const SizedBox(height: 14),
          ],
          TextFormField(
            key: const Key('bill-consumption'),
            controller: _consumption,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
            ],
            decoration: InputDecoration(
              labelText: widget.type == UtilityType.png
                  ? 'Gas consumption'
                  : 'Electricity consumption',
              suffixText: unit,
              helperText: widget.type == UtilityType.png
                  ? 'The gas used in this period, in SCM, as printed on the bill.'
                  : 'The units consumed in this period. One unit is one kWh.',
              prefixIcon: const Icon(Icons.speed_rounded),
            ),
            validator: (v) {
              final n = double.tryParse((v ?? '').trim());
              if (n == null || n < 0) return 'Enter the consumption in $unit';
              return null;
            },
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _DateField(
                  label: 'Period from',
                  value: _start == null ? null : date.format(_start!),
                  onTap: () => _pickDate(true),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _DateField(
                  label: 'Period to',
                  value: _end == null ? null : date.format(_end!),
                  onTap: () => _pickDate(false),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _ReadingField(
                  controller: _previous,
                  label: 'Previous reading',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _ReadingField(
                  controller: _current,
                  label: 'Current reading',
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          DharaCard(
            padding: const EdgeInsets.all(14),
            child: Text(
              consentText(widget.type),
              style: const TextStyle(fontSize: 12.5, height: 1.5),
            ),
          ),
          CheckboxListTile(
            key: const Key('bill-consent'),
            value: _consented,
            onChanged: (v) => setState(() => _consented = v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            title: const Text(
              'I agree',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(height: 10),
          FilledButton(
            key: const Key('bill-submit'),
            onPressed: _submitting || _reading ? null : _submit,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            child: _submitting
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: Colors.white,
                    ),
                  )
                : const Text('Save'),
          ),
        ],
      ),
    );
  }

  Widget _resultView(UtilityVerification v) {
    final reading = v.reading;
    final canUse = reading != null && widget.type == UtilityType.electricity;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        Text(
          v.status.explanation,
          style: const TextStyle(
            fontSize: 13.5,
            height: 1.5,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 14),
        if (reading != null) ReadingCard(reading: reading),
        const SizedBox(height: 20),
        if (canUse)
          FilledButton(
            onPressed: () => Navigator.of(context).pop(reading),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            child: const Text('Use in my footprint'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Done'),
        ),
      ],
    );
  }

  static String _tail(String account) {
    final v = UtilityProvider.normalize(account);
    return v.length <= 4 ? v : v.substring(v.length - 4);
  }
}

/// The real picker: the in-app camera, the gallery, or a PDF from files.
Future<String?> defaultBillPicker(
  BuildContext context,
  BillSource source,
) async {
  switch (source) {
    case BillSource.camera:
      return CameraCaptureScreen.push(
        context,
        title: 'Photograph your bill',
        hint: 'Lay the bill flat in good light so the figures are readable.',
      );
    case BillSource.gallery:
      return _localPath(await FilePicker.pickFile(type: FileType.image));
    case BillSource.pdf:
      return _localPath(
        await FilePicker.pickFile(
          type: FileType.custom,
          allowedExtensions: const ['pdf'],
        ),
      );
  }
}

/// Some Android pickers hand back a content URI rather than a file path; copy
/// those into the app's temporary folder so the rest of the flow has a file.
Future<String?> _localPath(PlatformFile? file) async {
  if (file == null) return null;
  final path = file.path;
  if (path != null) return path;
  final dir = await getTemporaryDirectory();
  final safe = file.name.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
  final out = File(
    '${dir.path}${Platform.pathSeparator}${DateTime.now().millisecondsSinceEpoch}_$safe',
  );
  await out.writeAsBytes(await file.readAsBytes());
  return out.path;
}

class _SourceButton extends StatelessWidget {
  const _SourceButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    onPressed: onTap,
    icon: Icon(icon, size: 18),
    label: Text(label),
    // The app theme gives outlined buttons an infinite minimum width,
    // which a Wrap cannot lay out.
    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
  );
}

class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: const Icon(Icons.event_rounded),
      ),
      child: Text(
        value ?? 'Choose',
        style: TextStyle(
          color: value == null ? AppColors.inkFaint : AppColors.ink,
        ),
      ),
    ),
  );
}

class _ReadingField extends StatelessWidget {
  const _ReadingField({required this.controller, required this.label});

  final TextEditingController controller;
  final String label;

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: controller,
    keyboardType: const TextInputType.numberWithOptions(decimal: true),
    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
    decoration: InputDecoration(labelText: label, helperText: 'Optional'),
  );
}
