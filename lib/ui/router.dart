import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../state/auth_controller.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/otp_screen.dart';
import 'screens/auth/signup_screen.dart';
import 'screens/auth/splash_screen.dart';
import 'screens/auth/welcome_screen.dart';
import 'screens/home/dashboard_shell.dart';

class Routes {
  const Routes._();

  static const splash = '/';
  static const welcome = '/welcome';
  static const signup = '/signup';
  static const login = '/login';
  static const verify = '/verify';
  static const home = '/home';

  /// Reachable only while signed out.
  static const _public = {welcome, signup, login};
}

/// Bridges Riverpod's auth state into something go_router will listen to.
///
/// go_router only re-runs `redirect` when its [Listenable] fires, so without
/// this a user who signs in would stay parked on the login screen.
class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh(Ref ref) {
    ref.listen(authControllerProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefresh(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: refresh,
    routes: [
      GoRoute(
        path: Routes.splash,
        builder: (_, _) => const SplashScreen(),
      ),
      GoRoute(
        path: Routes.welcome,
        builder: (_, _) => const WelcomeScreen(),
      ),
      GoRoute(
        path: Routes.signup,
        builder: (_, _) => const SignupScreen(),
      ),
      GoRoute(
        path: Routes.login,
        builder: (_, _) => const LoginScreen(),
      ),
      GoRoute(
        path: Routes.verify,
        builder: (_, _) => const OtpScreen(),
      ),
      GoRoute(
        path: Routes.home,
        builder: (_, _) => const DashboardShell(),
      ),
    ],
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final at = state.matchedLocation;

      // Session restore has not finished. Everything waits on the splash.
      if (!auth.hasValue) {
        return at == Routes.splash ? null : Routes.splash;
      }

      return switch (auth.value!) {
        // Mid-signup: the code screen is the only way forward or back, so the
        // user cannot slip into the app with an unconfirmed address.
        AuthAwaitingOtp() => at == Routes.verify ? null : Routes.verify,

        AuthSignedOut() =>
          Routes._public.contains(at) ? null : Routes.welcome,

        AuthSignedIn() =>
          Routes._public.contains(at) || at == Routes.splash || at == Routes.verify
              ? Routes.home
              : null,
      };
    },
  );
});
