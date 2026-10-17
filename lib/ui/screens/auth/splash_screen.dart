import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../../core/theme/app_colors.dart';
import '../../widgets/common.dart';

/// Shown while the persisted Appwrite session is being restored.
///
/// The router parks every route here until auth resolves, so this is the first
/// frame the user sees on a cold start.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LightStatusBar(
      child: Scaffold(
        body: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: AppColors.heroGradient,
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: const BrandLogo(size: 96),
                )
                    .animate()
                    .scale(
                      duration: 600.ms,
                      curve: Curves.easeOutBack,
                      begin: const Offset(0.7, 0.7),
                    )
                    .fadeIn(duration: 400.ms),
                const SizedBox(height: 28),
                Text(
                  'Dhara',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                ).animate(delay: 200.ms).fadeIn().slideY(begin: 0.4, end: 0),
                const SizedBox(height: 6),
                Text(
                  'Green Credits',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: AppColors.limeSoft,
                        letterSpacing: 3,
                      ),
                ).animate(delay: 340.ms).fadeIn(),
                const SizedBox(height: 46),
                const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.2,
                    color: Colors.white70,
                  ),
                ).animate(delay: 700.ms).fadeIn(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
