import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/haptics.dart';
import '../../../core/utils/validators.dart';
import '../../../state/auth_controller.dart';
import '../../router.dart';
import '../../widgets/common.dart';

/// Step one of three: name, email, password. Appwrite emails a code next.
class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _obscure = true;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (!(_form.currentState?.validate() ?? false)) {
      Haptics.warn();
      return;
    }

    Haptics.press();
    FocusScope.of(context).unfocus();
    setState(() => _busy = true);

    try {
      await ref.read(authControllerProvider.notifier).signUp(
            name: _name.text,
            email: _email.text,
            password: _password.text,
          );
      // On success the auth state flips to AuthAwaitingOtp and the router moves
      // to the code screen, so there is nothing to navigate here.
      Haptics.success();
    } on AuthFailure catch (e) {
      Haptics.error();
      if (mounted) showSnack(context, e.message, isError: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () {
            Haptics.tap();
            if (context.canPop()) {
              context.pop();
            } else {
              context.go(Routes.welcome);
            }
          },
        ),
      ),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
            children: [
              Text('Create your account', style: text.headlineMedium)
                  .animate()
                  .fadeIn()
                  .slideY(begin: 0.25, end: 0),
              const SizedBox(height: 8),
              Text(
                'We will email you a 6-digit code to confirm it is you.',
                style: text.bodyMedium?.copyWith(color: AppColors.inkSoft),
              ).animate(delay: 90.ms).fadeIn(),
              const SizedBox(height: 30),

              TextFormField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.name],
                decoration: const InputDecoration(
                  labelText: 'Full name',
                  prefixIcon: Icon(Icons.person_outline_rounded),
                ),
                validator: Validate.name,
              ).animate(delay: 160.ms).fadeIn().slideY(begin: 0.2, end: 0),
              const SizedBox(height: 16),

              TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.email],
                inputFormatters: [FilteringTextInputFormatter.deny(RegExp(r'\s'))],
                decoration: const InputDecoration(
                  labelText: 'Email',
                  prefixIcon: Icon(Icons.alternate_email_rounded),
                ),
                validator: Validate.email,
              ).animate(delay: 240.ms).fadeIn().slideY(begin: 0.2, end: 0),
              const SizedBox(height: 16),

              TextFormField(
                controller: _password,
                obscureText: _obscure,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.newPassword],
                onFieldSubmitted: (_) => _submit(),
                decoration: InputDecoration(
                  labelText: 'Password',
                  helperText: 'At least 8 characters',
                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                    onPressed: () {
                      Haptics.tap();
                      setState(() => _obscure = !_obscure);
                    },
                  ),
                ),
                validator: Validate.password,
              ).animate(delay: 320.ms).fadeIn().slideY(begin: 0.2, end: 0),
              const SizedBox(height: 30),

              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Send me the code'),
              ).animate(delay: 400.ms).fadeIn().slideY(begin: 0.3, end: 0),
              const SizedBox(height: 14),

              Center(
                child: TextButton(
                  onPressed: _busy
                      ? null
                      : () {
                          Haptics.tap();
                          context.go(Routes.login);
                        },
                  child: const Text('I already have an account'),
                ),
              ).animate(delay: 470.ms).fadeIn(),
            ],
          ),
        ),
      ),
    );
  }
}
