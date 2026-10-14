import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/application/session_controller.dart';
import '../../features/auth/data/models.dart';
import '../../features/auth/presentation/forgot_password_screen.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/register_step1_screen.dart';
import '../../features/auth/presentation/register_step2_screen.dart';
import '../../features/auth/presentation/splash_screen.dart';
import '../../features/auth/presentation/verify_code_screen.dart';
import '../../features/auth/presentation/welcome_screen.dart';
import '../../features/shell/presentation/account_screen.dart';
import '../../features/shell/presentation/home_shell.dart';

/// Fait réévaluer les redirections du routeur à chaque changement de session.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen<SessionState>(sessionProvider, (_, __) => notifyListeners());
  }
}

const _publicRoutes = {'/welcome', '/login', '/register/1', '/register/2', '/verify', '/forgot'};

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _SessionListenable(ref);
  ref.onDispose(refresh.dispose);
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      final loc = state.matchedLocation;
      return switch (session) {
        SessionUnknown() => loc == '/splash' ? null : '/splash',
        SessionSignedIn() => (loc == '/splash' || _publicRoutes.contains(loc)) ? '/home' : null,
        SessionSignedOut(visitor: true) => (loc == '/splash' || loc == '/account') ? '/home' : null,
        SessionSignedOut() => _publicRoutes.contains(loc) ? null : '/welcome',
      };
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/welcome', builder: (_, __) => const WelcomeScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/register/1', builder: (_, __) => const RegisterStep1Screen()),
      GoRoute(path: '/register/2', builder: (_, __) => const RegisterStep2Screen()),
      GoRoute(
        path: '/verify',
        builder: (_, state) => state.extra is Challenge ? VerifyCodeScreen(challenge: state.extra! as Challenge) : const WelcomeScreen(),
      ),
      GoRoute(path: '/forgot', builder: (_, __) => const ForgotPasswordScreen()),
      GoRoute(path: '/home', builder: (_, __) => const HomeShell()),
      GoRoute(path: '/account', builder: (_, __) => const AccountScreen()),
    ],
  );
});
