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
import '../../features/merchant/presentation/merchant_apply_screen.dart';
import '../../features/bimshop/presentation/bimshop_view.dart';
import '../../features/bimshop/presentation/product_screen.dart';
import '../../features/bimshop/presentation/shop_profile_screen.dart';
import '../../features/merchant/presentation/merchant_space_screen.dart';
import '../../features/offers/presentation/project_offers_screen.dart';
import '../../features/offers/presentation/shop_requests_screen.dart';
import '../../features/merchant/presentation/product_editor_screen.dart';
import '../../features/social/presentation/composer_screen.dart';
import '../../features/social/presentation/post_detail_screen.dart';
import '../../features/social/presentation/profile_screen.dart';

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
        // Espace boutique actif (lot 5-B) : l'accueil est l'espace marchand (écran 55) ; ailleurs, pas d'espace marchand.
        // Les projets et Peni sont réservés à l'espace utilisateur (le serveur répond 403 sinon, audit M-10).
        SessionSignedIn(:final me) when me.activeSpaceType == 'merchant' =>
          (loc == '/splash' || loc == '/home' || _publicRoutes.contains(loc) || loc.startsWith('/projects') || loc.startsWith('/peni')) ? '/shop' : null,
        SessionSignedIn() => (loc == '/splash' || _publicRoutes.contains(loc) || loc.startsWith('/shop')) ? '/home' : null,
        SessionSignedOut(visitor: true) =>
          (loc == '/splash' || const ['/account', '/projects', '/notifications', '/peni', '/social', '/posts', '/people', '/search', '/merchant', '/shop', '/bimshop/favorites'].any(loc.startsWith)) ? '/home' : null,
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
          return PeniChatScreen(mode: extra['mode'], budget: extra['budget'], purpose: extra['purpose'] ?? 'new_project', categoryCode: extra['categoryCode']);
        },
      ),
      GoRoute(path: '/projects/:id', builder: (_, s) => ProjectMapScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/projects/:id/program', builder: (_, s) => ProgramScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/projects/:id/done', builder: (_, s) => CelebrationScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/projects/:id/transformation', builder: (_, s) => TransformationScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/projects/:id/reports', builder: (_, s) => ReportsScreen(projectId: s.pathParameters['id']!)),
      GoRoute(path: '/reports', builder: (_, __) => const ReportsScreen()),
      // Lot 4 — social (écrans 10, 11, 12, 16, 52).
      GoRoute(path: '/social/new', builder: (_, s) => ComposerScreen(projectId: s.extra is String ? s.extra! as String : null)),
      GoRoute(path: '/posts/:id', builder: (_, s) => PostDetailScreen(postId: s.pathParameters['id']!)),
      GoRoute(path: '/people/:username', builder: (_, s) => ProfileScreen(username: s.pathParameters['username']!)),
      GoRoute(path: '/search', builder: (_, __) => const PeopleSearchScreen()),
      GoRoute(path: '/account/blocked', builder: (_, __) => const BlockedPeopleScreen()),
      // Lot 5-A — ouvrir une boutique (écrans 07 à 09).
      GoRoute(path: '/merchant/apply', builder: (_, __) => const MerchantApplyScreen()),
      GoRoute(path: '/shop', builder: (_, __) => const MerchantSpaceScreen()),
      GoRoute(path: '/shop/requests', builder: (_, __) => const ShopRequestsScreen()),
      GoRoute(path: '/projects/:id/offers', builder: (_, s) => ProjectOffersScreen(projectId: s.pathParameters['id']!)),
      // Lot 5-C : BimShop (public, sauf « Mis de côté »).
      GoRoute(path: '/bimshop/categories', builder: (_, __) => const RubriquesScreen()),
      GoRoute(path: '/bimshop/favorites', builder: (_, __) => const ShopFavoritesScreen()),
      GoRoute(path: '/bimshop/products/:id', builder: (_, s) => ShopProductScreen(productId: s.pathParameters['id']!)),
      GoRoute(path: '/bimshop/shops/:slug', builder: (_, s) => ShopProfileScreen(slug: s.pathParameters['slug']!)),
      GoRoute(path: '/shop/products/new', builder: (_, __) => const ProductEditorScreen()),
      GoRoute(path: '/shop/products/:id', builder: (_, s) => ProductEditorScreen(productId: s.pathParameters['id'])),
      GoRoute(
        path: '/projects/:id/day/:day',
        builder: (_, s) => ProjectDayScreen(projectId: s.pathParameters['id']!, day: s.pathParameters['day']!),
      ),
    ],
  );
});
