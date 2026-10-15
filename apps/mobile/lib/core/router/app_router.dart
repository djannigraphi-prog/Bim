import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/account/presentation/account_security_screens.dart';
import '../../features/auth/application/session_controller.dart';
import '../../features/auth/data/models.dart';
import '../../features/auth/presentation/forgot_password_screen.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/register_step1_screen.dart';
import '../../features/auth/presentation/register_step2_screen.dart';
import '../../features/auth/presentation/splash_screen.dart';
import '../../features/auth/presentation/verify_code_screen.dart';
import '../../features/auth/presentation/welcome_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/notifications/presentation/reminder_preferences_screen.dart';
import '../../features/peni/presentation/peni_chat_screen.dart';
import '../../features/projects/presentation/celebration_screen.dart';
import '../../features/projects/presentation/my_projects_screen.dart';
import '../../features/projects/presentation/new_project_screen.dart';
import '../../features/projects/presentation/program_screen.dart';
import '../../features/projects/presentation/project_day_screen.dart';
import '../../features/projects/presentation/project_map_screen.dart';
import '../../features/projects/presentation/reports_screen.dart';
import '../../features/projects/presentation/transformation_screen.dart';
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
        SessionSignedOut(visitor: true) =>
          (loc == '/splash' || loc.startsWith('/account') || loc.startsWith('/projects') || loc.startsWith('/notifications') || loc.startsWith('/peni')) ? '/home' : null,
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
      GoRoute(path: '/account/contacts', builder: (_, __) => const ContactsScreen()),
      GoRoute(path: '/account/password', builder: (_, __) => const ChangePasswordScreen()),
      GoRoute(path: '/account/devices', builder: (_, __) => const DevicesScreen()),
      // Lot 2 — préférences de rappel (choix de la personne ; le service des rappels n'est pas encore en service).
      GoRoute(path: '/account/reminders', builder: (_, __) => const ReminderPreferencesScreen()),
      // Lot 2 — centre de notifications (écran 17).
      GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
      // Lot 1 — projets BIM (écrans 18 à 30).
      GoRoute(path: '/projects', builder: (_, __) => const MyProjectsScreen()),
      GoRoute(path: '/projects/new', builder: (_, __) => const NewProjectScreen()),
      // Lot 3 — Peni (écran 25) : rend un brouillon de projet à l'écran « Nouveau projet ».
      GoRoute(
        path: '/peni/new-project',
        builder: (_, s) {
          final extra = s.extra is Map<String, String?> ? s.extra! as Map<String, String?> : const <String, String?>{};
          return PeniChatScreen(mode: extra['mode'], budget: extra['budget']);
        },
      ),
      GoRoute(path: '/projects/:id', builder: (_, s) => ProjectMapScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/projects/:id/program', builder: (_, s) => ProgramScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/projects/:id/done', builder: (_, s) => CelebrationScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/projects/:id/transformation', builder: (_, s) => TransformationScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/projects/:id/reports', builder: (_, s) => ReportsScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/reports', builder: (_, __) => const ReportsScreen()),
      GoRoute(
        path: '/projects/:id/day/:day',
        builder: (_, s) => ProjectDayScreen(projectId: s.pathParameters['id']!, day: s.pathParameters['day']!),
      ),
    ],
  );
});
