// Captures des écrans du lot 0 pour les comparer aux maquettes 01 à 06 (format iPhone 390 × 844, ×3).
// Lancé par la CI avec `flutter test test_captures --update-goldens` : ce ne sont pas des tests de non-régression,
// seulement des images à examiner. Les polices réelles (Roboto, icônes Material) sont chargées depuis le SDK Flutter ;
// sans elles le texte serait dessiné en carrés et la comparaison n'aurait pas de sens, donc le test échoue.
//
// Aucune donnée fictive n'est présentée comme réelle : le serveur est remplacé par un faux qui renvoie
// la liste des centres d'intérêt de la migration 0001 et « connexions sociales non configurées ».
import 'dart:io';

import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/account/data/account_api.dart';
import 'package:bim/features/account/presentation/account_security_screens.dart';
import 'package:bim/features/auth/application/session_controller.dart';
import 'package:bim/features/shell/presentation/account_screen.dart';
import 'package:bim/features/auth/data/auth_api.dart';
import 'package:bim/features/auth/data/models.dart';
import 'package:bim/features/auth/presentation/forgot_password_screen.dart';
import 'package:bim/features/auth/presentation/login_screen.dart';
import 'package:bim/features/auth/presentation/register_step1_screen.dart';
import 'package:bim/features/auth/presentation/register_step2_screen.dart';
import 'package:bim/features/auth/presentation/splash_screen.dart';
import 'package:bim/features/auth/presentation/verify_code_screen.dart';
import 'package:bim/features/auth/presentation/welcome_screen.dart';
import 'package:bim/features/notifications/data/inbox_api.dart';
import 'package:bim/features/notifications/data/notification_preferences_api.dart';
import 'package:bim/features/notifications/presentation/notifications_screen.dart';
import 'package:bim/features/notifications/presentation/reminder_preferences_screen.dart';
import 'package:bim/features/peni/data/peni_api.dart';
import 'package:bim/features/peni/presentation/peni_chat_screen.dart';
import 'package:bim/features/projects/data/projects_api.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:bim/features/projects/presentation/celebration_screen.dart';
import 'package:bim/features/projects/presentation/my_projects_screen.dart';
import 'package:bim/features/projects/presentation/new_project_screen.dart';
import 'package:bim/features/projects/presentation/program_screen.dart';
import 'package:bim/features/projects/presentation/project_day_screen.dart';
import 'package:bim/features/projects/presentation/project_map_screen.dart';
import 'package:bim/features/projects/presentation/reports_screen.dart';
import 'package:bim/features/projects/presentation/transformation_screen.dart';
import 'package:bim/features/shell/presentation/home_shell.dart';
import 'package:bim/features/merchant/data/merchant_api.dart';
import 'package:bim/features/merchant/presentation/merchant_apply_screen.dart';
import 'package:bim/features/merchant/data/shop_api.dart';
import 'package:bim/features/bimshop/data/bimshop_api.dart';
import 'package:bim/features/messaging/data/messaging_api.dart';
import 'package:bim/features/messaging/presentation/conversation_screen.dart';
import 'package:bim/features/messaging/presentation/messages_view.dart';
import 'package:bim/features/offers/data/offers_api.dart';
import 'package:bim/features/offers/presentation/project_offers_screen.dart';
import 'package:bim/features/offers/presentation/shop_requests_screen.dart';
import 'package:bim/features/bimshop/presentation/bimshop_view.dart';
import 'package:bim/features/bimshop/presentation/product_screen.dart';
import 'package:bim/features/bimshop/presentation/shop_profile_screen.dart';
import 'package:bim/features/merchant/presentation/merchant_space_screen.dart';
import 'package:bim/features/merchant/presentation/product_editor_screen.dart';
import 'package:bim/features/social/data/social_api.dart';
import 'package:bim/features/social/data/social_models.dart';
import 'package:bim/features/social/presentation/composer_screen.dart';
import 'package:bim/features/social/presentation/post_detail_screen.dart';
import 'package:bim/features/social/presentation/profile_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
  @override
  Future<void> clear() async {}
  @override
  Future<void> save({required String accessToken, required String refreshToken}) async {}
}

/// Données de démonstration POUR LES CAPTURES UNIQUEMENT.
class _FakeAccountApi extends AccountApi {
  _FakeAccountApi(super.api);

  @override
  Future<List<DeviceSession>> sessions() async => [
        DeviceSession(id: 's1', userAgent: 'Dart/3.13 (dart:io)', lastUsedAt: DateTime.now(), current: true),
        DeviceSession(id: 's2', userAgent: 'Mozilla/5.0 (Linux; Android 14)', lastUsedAt: DateTime.now().subtract(const Duration(days: 2)), current: false),
      ];

  @override
  Future<List<SpaceItem>> spaces() async => const [SpaceItem(type: 'user', id: 'u1', label: 'Awa Koné', status: 'active', usable: true, active: true)];
}

/// Préférences de rappel POUR LES CAPTURES UNIQUEMENT : état réel d'un nouveau compte aujourd'hui
/// (service des rappels fermé ; heures calmes = valeur par défaut de la migration 0012, non validée).
class _FakeNotificationPreferencesApi extends NotificationPreferencesApi {
  _FakeNotificationPreferencesApi(super.api);

  @override
  Future<NotificationPreferences> load() async => const NotificationPreferences(
        remindersEnabled: false,
        quietHours: QuietHours(start: '22:00', end: '06:00'),
        quietHoursArePersonal: false,
        remindersAvailable: false,
      );
}

/// Notifications de démonstration POUR LES CAPTURES UNIQUEMENT (types et textes réels de l'API, données inventées).
/// Discussion de la maquette 25, POUR LES CAPTURES UNIQUEMENT : textes identiques à ceux que produit l'API pour ces
/// messages (moteur guided-v1, vérifiés par `engine.spec.ts`), sans serveur.
class _FakePeniApi extends PeniApi {
  _FakePeniApi(super.api);

  @override
  Future<PeniTurn> start({String purpose = 'new_project', String? mode, String? budget, String? categoryCode}) async => const PeniTurn(
        conversationId: 'c1',
        messages: [
          PeniMessage(id: '1', role: 'peni', text: 'Coucou Yannick ! 🥰 Raconte-moi : qu’est-ce que tu aimerais changer ?', pose: 'wave'),
          PeniMessage(id: '2', role: 'user', text: 'Je veux perdre du ventre avant mon mariage en décembre. Mais j’ai pas trop le temps la semaine 😅'),
          PeniMessage(
            id: '3',
            role: 'peni',
            text: 'Félicitations pour le mariage !! 💍 On a environ 7 semaines, c’est parfait. Combien de fois par semaine peux-tu t’y mettre ?',
            pose: 'think',
          ),
          PeniMessage(id: '4', role: 'user', text: 'En salle, le samedi et le dimanche matin'),
          PeniMessage(
            id: '5',
            role: 'peni',
            text: 'Tu préfères un projet économique, avec des solutions gratuites, ou Premium, avec des idées d’achats ? Le choix est gratuit.',
            pose: 'think',
          ),
          PeniMessage(id: '6', role: 'user', text: 'Premium'),
          PeniMessage(id: '7', role: 'peni', text: 'Quel budget indicatif ? Rien n’est payé dans BIM.', pose: 'think'),
          PeniMessage(id: '8', role: 'user', text: 'Moyen · ≈ 35 000 F'),
          PeniMessage(
            id: '9',
            role: 'peni',
            text: 'Top ! J’ai noté tout ça 👇',
            pose: 'cheer',
            quickReplies: [PeniQuickReply(id: 'restart', label: 'Recommencer')],
            summary: [
              (label: 'Catégorie', value: 'Sport · Abdos'),
              (label: 'Durée', value: '30 jours'),
              (label: 'Séances', value: '2 / semaine'),
              (label: 'Moment', value: 'Le matin'),
              (label: 'Mode', value: 'Premium · moyen'),
            ],
          ),
        ],
        draft: ProjectDraft(mode: 'premium', budget: 'medium', categoryCode: 'sport', goalCode: 'sport_abdos', sessionsPerWeek: 2, availability: 'morning', durationDays: 30),
      );

  /// Explication de la tâche t1 du projet de démonstration (lundi, mercredi, vendredi à 15 h), textes de l'API v1.
  @override
  Future<PeniTaskExplanation> explainTask(String projectId, String taskId) async => const PeniTaskExplanation(
        taskId: 't1',
        title: 'Séance · Perte de poids',
        intro: 'Bonne question ! Voici « Séance · Perte de poids » expliquée simplement 👇',
        pose: 'think',
        sections: [
          (
            id: 'what',
            question: 'C’est quoi ?',
            answer:
                'C’est ta séance de sport · perte de poids. Je l’ai préparée à partir de tes réponses. Le détail des exercices n’est pas encore rédigé par l’équipe BIM pour cette catégorie : en attendant, tu choisis ce que tu fais, à ton rythme.',
          ),
          (id: 'when', question: 'Quand ?', answer: 'À 15 h, le lundi, le mercredi et le vendredi : 3 fois par semaine.'),
          (
            id: 'how',
            question: 'Comment m’y prendre ?',
            answer:
                'Commence doucement : quelques minutes pour t’échauffer, puis va à ton rythme. Bois de l’eau, et arrête-toi si tu as mal. Au moindre doute sur ta santé, demande l’avis d’un professionnel de santé. Quand c’est fait, coche la tâche dans ta journée ✅',
          ),
          (id: 'missed', question: 'Et si je ne peux pas ?', answer: 'Pas grave 💛 Une tâche non cochée ne te fait rien perdre : ton programme continue.'),
          (id: 'reminders', question: 'Vais-je avoir un rappel ?', answer: 'Tes rappels sont désactivés. Tu peux les activer quand tu veux dans Paramètres → Rappels.'),
        ],
      );
}

class _FakeInboxApi extends InboxApi {
  _FakeInboxApi(super.api);

  static final now = DateTime(2026, 10, 15, 18);

  @override
  Future<InboxPage> page({String? category, String? before, String? beforeId}) async => InboxPage(
        items: [
          InboxItem(id: 'r1', type: 'task_reminder', category: 'projects', sender: 'peni', text: 'C’est l’heure : Séance d’abdos. On y va ?', at: now.subtract(const Duration(minutes: 5)), unread: true, link: null),
          InboxItem(id: 's1', type: 'report_answered', category: 'support', sender: 'bim', text: 'L’équipe BIM a répondu à ton signalement.', at: now.subtract(const Duration(hours: 2)), unread: true, link: null),
          InboxItem(id: 'c1', type: 'chest_opened', category: 'projects', sender: 'peni', text: 'Coffre de la semaine 1 ouvert pour « Abdos en 30 jours ». Continue comme ça !', at: now.subtract(const Duration(days: 2)), unread: false, link: null),
        ].where((i) => category == null || i.category == category).toList(),
        nextBefore: null,
      );

  @override
  Future<void> markSeen() async {}

  @override
  Future<int> unreadCount() async => 2;
}

const _demoMe = {
  'id': 'u1',
  'fullName': 'Awa Koné',
  'username': 'awa.kone',
  'city': 'Cocody',
  'preferences': {'theme': 'light'},
  'contacts': [
    {'id': 'c1', 'type': 'phone', 'value': '+2250700000000', 'verified': true},
    {'id': 'c2', 'type': 'email', 'value': 'awa@exemple.com', 'verified': true},
  ],
};

class _FakeAuthApi extends AuthApi {
  _FakeAuthApi(super.api);

  // Liste identique à la migration 0001 (référentiel réel, pas un exemple inventé).
  @override
  Future<List<Interest>> interests() async => const [
        Interest(code: 'mode', label: 'Mode', icon: 'shirt'),
        Interest(code: 'sport_coaching', label: 'Sport & coaching', icon: 'dumbbell'),
        Interest(code: 'beaute_esthetique', label: 'Beauté / esthétique', icon: 'sparkles'),
        Interest(code: 'soins_spa', label: 'Soins / spa', icon: 'flower'),
        Interest(code: 'coiffure', label: 'Coiffure', icon: 'scissors'),
        Interest(code: 'maquillage', label: 'Maquillage', icon: 'brush'),
        Interest(code: 'ongles', label: 'Ongles', icon: 'hand'),
        Interest(code: 'bien_etre', label: 'Bien-être', icon: 'leaf'),
        Interest(code: 'lifestyle', label: 'Lifestyle', icon: 'camera'),
        Interest(code: 'accessoires', label: 'Accessoires', icon: 'glasses'),
      ];

  @override
  Future<Map<String, bool>> socialProviders() async => const {'google': false, 'apple': false, 'facebook': false};
}


/// Demande de boutique de démonstration POUR LES CAPTURES UNIQUEMENT (écran 07, pièce et numéro déjà faits).
class _FakeMerchantApi extends MerchantApi {
  _FakeMerchantApi(super.api);

  @override
  Future<({MerchantApplication? application, bool available})> mine() async => (
        application: const MerchantApplication(
          id: 'a1',
          status: 'draft',
          shopName: 'Boutique Élégance',
          city: 'Abidjan',
          identity: true,
          selfie: false,
          payout: true,
          address: false,
          ready: false,
          idDocType: 'cni',
          payoutOperator: 'wave',
          payoutPhoneEnd: '04',
        ),
        available: true,
      );
}

/// Boutique de démonstration POUR LES CAPTURES UNIQUEMENT (écran 55 ; articles inventés, sans photo faute de serveur).
class _FakeShopApi extends ShopApi {
  _FakeShopApi(super.api);

  static const _items = [
    ProductSummary(id: 'x1', kind: 'product', title: 'Robe soirée à plumes', priceFcfa: 45000, compareAtFcfa: 60000, status: 'published', stock: 7),
    ProductSummary(id: 'x2', kind: 'product', title: 'Ensemble wax corporate', priceFcfa: 32000, status: 'published', stock: 0),
    ProductSummary(id: 'x3', kind: 'service', title: 'Retouche et ajustement', priceFcfa: 5000, status: 'published'),
  ];

  @override
  Future<ShopDashboard> dashboard() async =>
      const ShopDashboard(id: 's1', name: 'Boutique Élégance', status: 'active', verified: true, city: 'Abidjan', commune: 'Cocody', published: 3, drafts: 1, followers: 0);

  @override
  Future<List<ProductSummary>> products({required String status}) async => status == 'published' ? _items : const [];

  // Rubriques identiques à la migration 0022 (extrait).
  @override
  Future<List<ShopCategory>> categories() async => const [
        ShopCategory(code: 'vetements', label: 'Vêtements', children: [ShopCategory(code: 'vetements_soiree', label: 'Soirée'), ShopCategory(code: 'vetements_corporate', label: 'Corporate')]),
        ShopCategory(code: 'services', label: 'Services'),
      ];

  @override
  Future<ProductDetail> product(String id) async => const ProductDetail(
        id: 'x1',
        kind: 'product',
        title: 'Robe soirée à plumes',
        description: 'Plumes cousues main, doublure satin.',
        categoryCode: 'vetements_soiree',
        priceFcfa: 45000,
        compareAtFcfa: 60000,
        status: 'published',
        photos: [ProductPhoto(id: 'm1', url: null)],
        variants: [ProductVariant(id: 'v1', label: 'S', stock: 2), ProductVariant(id: 'v2', label: 'M', stock: 3), ProductVariant(id: 'v3', label: 'L', stock: 2)],
      );
}

/// BimShop de démonstration POUR LES CAPTURES UNIQUEMENT (écrans 32, 33, 34, 54 ; boutiques et articles inventés,
/// sans photo faute de serveur).
class _FakeBimShopApi extends BimShopApi {
  _FakeBimShopApi(super.api);

  static const _elegance = ShopRef(id: 's1', name: 'Boutique Élégance', slug: 'boutique-elegance', verified: true, city: 'Abidjan', commune: 'Cocody');
  static const _kalia = ShopRef(id: 's2', name: 'Kalia Sport', slug: 'kalia-sport', verified: false, city: 'Abidjan', commune: 'Marcory');
  static const _cards = [
    ShopCard(id: 'x1', kind: 'product', title: 'Robe soirée à plumes', priceFcfa: 45000, compareAtFcfa: 60000, available: true, shop: _elegance),
    ShopCard(id: 'x2', kind: 'product', title: 'Ensemble wax corporate', priceFcfa: 32000, available: true, shop: _elegance),
    ShopCard(id: 'x4', kind: 'product', title: 'Legging de sport respirant', priceFcfa: 8500, available: true, shop: _kalia),
    ShopCard(id: 'x5', kind: 'product', title: 'Brassière maintien fort', priceFcfa: 7000, available: false, shop: _kalia),
  ];

  @override
  Future<({List<ShopCard> items, String? nextCursor})> browse(BimShopQuery query, {String? cursor}) async => (items: _cards, nextCursor: null);

  // Rubriques identiques à la migration 0022 ; nombres d'articles de démonstration.
  @override
  Future<List<Rubrique>> categories() async => const [
        Rubrique(code: 'vetements', label: 'Vêtements', products: 2, children: [
          Rubrique(code: 'vetements_corporate', label: 'Corporate', products: 1),
          Rubrique(code: 'vetements_plage', label: 'Plage', products: 0),
          Rubrique(code: 'vetements_artistique', label: 'Artistique / Créatif', products: 0),
          Rubrique(code: 'vetements_traditionnel', label: 'Traditionnel / Culturel', products: 0),
          Rubrique(code: 'vetements_soiree', label: 'Soirée', products: 1),
          Rubrique(code: 'vetements_sport', label: 'Sport', products: 0),
          Rubrique(code: 'vetements_autres', label: 'Autres', products: 0),
        ],),
        Rubrique(code: 'accessoires', label: 'Accessoires', products: 0),
        Rubrique(code: 'sante', label: 'Santé / Esthétique', products: 0),
        Rubrique(code: 'sport', label: 'Sport & Coaching', products: 2),
        Rubrique(code: 'services', label: 'Services', products: 0),
      ];

  @override
  Future<ShopProduct> product(String id) async => ShopProduct(
        id: 'x1',
        kind: 'product',
        title: 'Robe soirée à plumes',
        description: 'Plumes cousues main, doublure satin. Retouches offertes en boutique.',
        priceFcfa: 45000,
        compareAtFcfa: 60000,
        categoryLabel: 'Vêtements · Soirée',
        available: true,
        photos: const [null, null, null],
        variants: const [(id: 'v1', label: 'S', available: true), (id: 'v2', label: 'M', available: true), (id: 'v3', label: 'L', available: false)],
        shop: _elegance,
        moreFromShop: [_cards[1]],
      );

  @override
  Future<PublicShop> shop(String slug) async =>
      PublicShop(shop: _elegance, description: 'Robes de soirée et tenues corporate, retouches sur place.', followers: 0, productCount: 2, items: _cards.sublist(0, 2));
}

/// Offres et demandes de démonstration POUR LES CAPTURES UNIQUEMENT (écrans 24, 49, 55 ; boutiques inventées).
class _FakeOffersApi extends OffersApi {
  _FakeOffersApi(super.api);

  @override
  Future<({bool premiumOnly, List<ShopCard> items})> recommendations(String projectId) async => (premiumOnly: false, items: _FakeBimShopApi._cards.sublist(2));

  @override
  Future<({bool receiveOffers, List<ProjectOffer> items})> projectOffers(String projectId) async => (
        receiveOffers: true,
        items: [
          ProjectOffer(
            id: 'o1',
            message: 'Bonjour ! Pour ton programme abdos, nos leggings respirants tiennent bien pendant les séances. Livraison à Abidjan.',
            shop: _FakeBimShopApi._kalia,
            products: _FakeBimShopApi._cards.sublist(2, 3),
            createdAt: DateTime(2026, 10, 16, 9),
          ),
        ],
      );

  @override
  Future<({List<ProjectRequest> items, String? hint})> requests() async => (
        items: const [
          ProjectRequest(id: 'r1', category: 'Sport', title: 'Renforcer mes abdos', goal: 'Abdos', mode: 'premium', durationDays: 30, city: 'Cocody'),
          ProjectRequest(id: 'r2', category: 'Sport', title: 'Perdre 6 kg', goal: 'Perte de poids', mode: 'eco', durationDays: 60, offerStatus: 'sent'),
        ],
        hint: null,
      );
}

/// Messages de démonstration POUR LES CAPTURES UNIQUEMENT (écran 47 ; personnes et textes inventés).
class _FakeMessagingApi extends MessagingApi {
  _FakeMessagingApi(super.api);

  static const _awa = PersonRef(id: 'u2', username: 'awa.kone', fullName: 'Awa Koné');
  static const _koffi = PersonRef(id: 'u3', username: 'koffi.coach', fullName: 'Koffi Yao');

  @override
  Future<({List<ConversationSummary> items, String? nextCursor})> conversations({bool requests = false, String? cursor}) async => (
        items: requests
            ? [ConversationSummary(id: 'r1', status: 'request', pendingForOther: false, person: _koffi, unread: 1, lastPreview: 'Bonjour ! Je suis coach à Cocody.', lastAt: DateTime.now().subtract(const Duration(hours: 3)))]
            : [
                ConversationSummary(id: 'c1', status: 'active', pendingForOther: false, person: _awa, unread: 2, lastPreview: 'On fait la séance ensemble samedi ?', lastAt: DateTime.now().subtract(const Duration(minutes: 4))),
              ],
        nextCursor: null,
      );

  @override
  Future<({int conversations, int requests})> unreadCount() async => (conversations: 1, requests: 1);

  @override
  Future<ConversationSummary> conversation(String id) async =>
      ConversationSummary(id: id, status: 'active', pendingForOther: false, person: _awa, unread: 0, lastPreview: null);

  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async => (
        items: [
          ChatMessage(id: 'm4', mine: true, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 9, 6), text: 'Oui ! 8 h au parc ?', read: true),
          ChatMessage(id: 'm3', mine: false, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 9, 4), text: 'On fait la séance ensemble samedi ?'),
          ChatMessage(id: 'm2', mine: true, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 9, 1), text: 'Jour 12 validé, les abdos piquent 😅'),
          ChatMessage(id: 'm1', mine: false, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 9), text: 'Alors, ce programme ?'),
        ],
        nextBefore: null,
      );

  @override
  Future<void> read(String conversationId) async {}
}

/// Publications de démonstration POUR LES CAPTURES UNIQUEMENT (personnes et textes inventés, aucune photo réelle :
/// les images s'affichent en emplacement neutre, faute de serveur).
class _FakeSocialApi extends SocialApi {
  _FakeSocialApi(super.api);

  static const _edwige = PersonRef(id: 'u1', username: 'edwige.k', fullName: 'Edwige Koffi');
  static const _me = PersonRef(id: 'u0', username: 'yannick.doho', fullName: 'Doho Yannick');
  static final _bim = FeedPost(
    id: 'p1',
    kind: 'bim',
    text: 'De 90 kg à 65 kg, j’ai transformé mon style et ma vie. Ce BIM est celui dont je suis la plus fière…',
    visibility: 'public',
    createdAt: DateTime.now().subtract(const Duration(hours: 3)),
    author: _edwige,
    media: const [
      PostMedia(id: 'b', kind: 'before', width: 800, height: 1000, takenDay: '2026-08-14'),
      PostMedia(id: 'a', kind: 'after', width: 800, height: 1000, takenDay: '2026-10-13'),
    ],
    journey: const Journey(category: 'Style & look', goal: 'Silhouette', days: 30, stepsDone: 24),
    likeCount: 10240,
    commentCount: 214,
    likedByMe: true,
    isMine: false,
    followingAuthor: false,
  );

  @override
  Future<FeedPage> feed({required String tab, String? cursor}) async => FeedPage(items: tab == 'following' ? const [] : [_bim]);

  @override
  Future<FeedPage> publicFeed({String? cursor}) async => FeedPage(items: [_bim]);

  @override
  Future<StoryTray> stories() async => StoryTray(items: [
        for (final (i, n) in const [('Awa Koné', false), ('Nina Bamba', false), ('Coach Karim', true), ('Belle Rosette', true)].indexed)
          StoryGroup(
            author: PersonRef(id: 's$i', username: 'demo$i', fullName: n.$1),
            allSeen: n.$2,
            items: [StoryItem(id: 'st$i', url: '', createdAt: DateTime.now(), seen: n.$2)],
          ),
      ],);

  @override
  Future<FeedPost> post(String id) async => _bim;

  @override
  Future<CommentsPage> comments(String postId, {String? cursor}) async => CommentsPage(total: 3, items: [
        PostComment(id: 'c1', text: 'Bravo, ça motive ! ✨', createdAt: DateTime.now().subtract(const Duration(hours: 2)), author: _me, likeCount: 12, likedByMe: false, canDelete: false, isMine: false),
        PostComment(id: 'c2', parentId: 'c1', text: 'Merci ! Le coach m’a bien aidée 😍', createdAt: DateTime.now().subtract(const Duration(hours: 1)), author: _edwige, likeCount: 3, likedByMe: true, canDelete: false, isMine: false),
        PostComment(id: 'c3', text: 'Tu as suivi quel programme ?', createdAt: DateTime.now().subtract(const Duration(minutes: 20)), author: const PersonRef(id: 'u2', username: 'davila', fullName: 'Davila Koula'), likeCount: 0, likedByMe: false, canDelete: false, isMine: false),
      ],);

  @override
  Future<PublicProfile> profile(String username) async =>
      const PublicProfile(person: _me, bims: 34, followers: 2830, following: 120, projects: 3, isMe: true, followedByMe: false, followsMe: false, blockedByMe: false, city: 'Abidjan');

  @override
  Future<FeedPage> personPosts(String username, {String? cursor}) async => FeedPage(items: [
        _bim,
        for (var i = 0; i < 5; i++)
          FeedPost(id: 'g$i', kind: 'post', text: 'Séance du jour ${i + 1} 💪', visibility: 'public', createdAt: DateTime.now(), author: _me, media: const [], likeCount: 0, commentCount: 0, likedByMe: false, isMine: true, followingAuthor: false),
      ],);
}

/// Données de démonstration POUR LES CAPTURES UNIQUEMENT (jamais affichées dans l'app) ; le catalogue reprend la migration 0005.
class _FakeProjectsApi extends ProjectsApi {
  _FakeProjectsApi(super.api);

  static String iso(int offset) => DateTime.now().toUtc().add(Duration(days: offset)).toIso8601String().substring(0, 10);

  @override
  Future<ProjectCatalog> catalog() async => ProjectCatalog.fromJson({
        'categories': [
          for (final (code, label, icon, tint) in [
            ('sport', 'Sport', 'dumbbell', '#FDECEF'),
            ('style_look', 'Style & look', 'shirt', '#EEF0FF'),
            ('visage_peau', 'Visage & peau', 'sparkles', '#FFF4E5'),
            ('cheveux_coiffure', 'Cheveux & coiffure', 'scissors', '#EAF3FF'),
            ('ongles_mains', 'Ongles & mains', 'hand', '#FDEFF3'),
            ('maquillage', 'Maquillage', 'brush', '#F3EEFF'),
            ('bien_etre_spa', 'Bien-être & spa', 'flower', '#EAF7EF'),
          ])
            {
              'code': code,
              'label': label,
              'icon': icon,
              'tint': tint,
              'hasValidatedPrograms': false,
              'goals': code != 'sport'
                  ? <Map<String, dynamic>>[]
                  : [
                      {'code': 'sport_perte_poids', 'label': 'Perte de poids', 'quantityUnit': 'kg', 'quantityMin': 1, 'quantityMax': 30},
                      for (final g in ['Fessiers', 'Abdos', 'Pectoraux', 'Bras', 'Cuisses', 'Cardio & endurance', 'Prise de masse', 'Souplesse', 'Remise en forme'])
                        {'code': g, 'label': g, 'quantityUnit': null, 'quantityMin': null, 'quantityMax': null},
                    ],
            },
        ],
        'durationsDays': [30, 60, 90],
        'budgetTiers': {'small': '≈ 10 000 F', 'medium': '≈ 35 000 F', 'boosted': '75 000 F +'},
        'availabilityTimes': {'morning': '07:00', 'noon': '12:30', 'afternoon': '15:00'},
        'maxActive': 5,
      });

  static Map<String, dynamic> _summary(String id, String title, String cat, String icon, String mode, String status, int dayN, int dur, int progress) => {
        'id': id,
        'title': title,
        'categoryCode': cat,
        'categoryLabel': cat,
        'icon': icon,
        'mode': mode,
        'status': status,
        'isPublic': false,
        'startDate': iso(-dayN + 1),
        'plannedEndDate': iso(dur - dayN),
        'pausedUntil': null,
        'durationDays': dur,
        'currentDay': dayN,
        'progress': progress,
        'streak': 3,
        'nextTask': status == 'active' ? {'id': 't1', 'title': 'Séance · Perte de poids', 'detail': null, 'icon': 'dumbbell', 'timeOfDay': '15:00'} : null,
      };

  @override
  Future<ProjectList> list() async => ProjectList.fromJson({
        'items': [
          _summary('p1', 'Perdre 10 kg', 'Sport', 'dumbbell', 'premium', 'active', 5, 60, 42),
          _summary('p2', 'Améliorer mon look', 'Style & look', 'shirt', 'eco', 'active', 24, 30, 78),
          _summary('p3', 'Avoir une peau soyeuse', 'Visage & peau', 'sparkles', 'premium', 'completed', 30, 30, 100),
        ],
        'activeCount': 2,
        'maxActive': 5,
        'today': iso(0),
      });

  @override
  Future<ProjectDetail> detail(String id) async {
    final states = ['done', 'done', 'missed', 'done', 'today'];
    return ProjectDetail.fromJson({
      ..._summary(id, 'Perdre 10 kg', 'Sport', 'dumbbell', 'premium', id == 'p3' ? 'completed' : 'active', 5, 60, 42),
      'goal': {'code': 'sport_perte_poids', 'label': 'Perte de poids', 'quantityUnit': 'kg'},
      'programSource': 'answers',
      'program': null,
      'measurement': {
        'unit': 'kg',
        'items': [
          {'day': iso(-60), 'value': 84},
          {'day': iso(0), 'value': 73.6},
        ],
        'start': 84,
        'latest': 73.6,
        'change': -10.4,
      },
      'totalSteps': 48,
      'completedSteps': 20,
      'bestStreak': 9,
      'sessionsPerWeek': 3,
      'healthNote': null,
      'tasks': [
        {'id': 't1', 'title': 'Séance · Perte de poids', 'detail': 'Créée à partir de tes réponses.', 'icon': 'dumbbell', 'timeOfDay': '15:00', 'weekdays': 21, 'origin': 'answers'},
        {'id': 't2', 'title': 'Étirements', 'detail': '15 min', 'icon': 'check', 'timeOfDay': '21:00', 'weekdays': 127, 'origin': 'user'},
      ],
      'days': [
        for (var i = 0; i < 60; i++)
          {'day': iso(i - 4), 'index': i + 1, 'due': 2, 'done': i < 4 && states[i] == 'done' ? 2 : 0, 'state': i < 5 ? states[i] : 'upcoming'},
      ],
      'today': iso(0),
      // Coffres de démonstration (écran 26) : semaine 1 ouverte, semaine 2 à venir, coffre final à venir.
      'chests': [
        {'kind': 'week', 'week': 1, 'day': iso(2), 'fromIndex': 1, 'toIndex': 7, 'due': 14, 'done': 10, 'state': 'open'},
        {'kind': 'week', 'week': 2, 'day': iso(9), 'fromIndex': 8, 'toIndex': 14, 'due': 10, 'done': 0, 'state': 'upcoming'},
        {'kind': 'final', 'week': null, 'day': iso(55), 'fromIndex': 1, 'toIndex': 60, 'due': 96, 'done': 20, 'state': 'upcoming'},
      ],
    });
  }

  @override
  Future<({bool available, List<ProjectPhoto> items})> photos(String id) async => (available: true, items: const <ProjectPhoto>[]);

  @override
  Future<List<ProjectReport>> reports({String? projectId}) async => [
        ProjectReport(id: 'r1', projectId: 'p1', projectTitle: 'Perdre 10 kg', day: iso(-1), reason: 'unavailable', message: 'Salle fermée (démonstration)', status: 'resolved', resolution: 'Merci, nous avons prévenu le partenaire (démonstration).'),
        ProjectReport(id: 'r2', projectId: 'p1', projectTitle: 'Perdre 10 kg', day: iso(0), reason: 'too_hard', status: 'open'),
        if (projectId == null)
          ProjectReport(id: 'r3', context: 'general', reason: 'app', message: 'Le bouton Continuer ne réagit pas (démonstration).', status: 'open', createdAt: DateTime.now()),
      ];

  @override
  Future<DayPlan> day(String id, String day) async => DayPlan.fromJson({
        'day': day,
        'index': 5,
        'durationDays': 60,
        'state': 'today',
        'editable': true,
        'tip': {'text': '2 grands verres d’eau avant chaque repas (texte de démonstration).', 'validatedBy': 'Personne de démonstration'},
        'tasks': [
          {'id': 't0', 'title': 'Marche', 'detail': '10 min', 'icon': 'leaf', 'timeOfDay': '07:00', 'done': true},
          {'id': 't1', 'title': 'Séance · Perte de poids', 'detail': 'Créée à partir de tes réponses.', 'icon': 'dumbbell', 'timeOfDay': '15:00', 'done': false},
          {'id': 't2', 'title': 'Étirements', 'detail': '15 min', 'icon': 'check', 'timeOfDay': '21:00', 'done': false},
        ],
      });
}

Future<void> _loadSdkFonts() async {
  final root = Platform.environment['FLUTTER_ROOT'];
  if (root == null) fail('FLUTTER_ROOT absent : polices du SDK introuvables.');
  final dir = Directory('$root/bin/cache/artifacts/material_fonts');
  final files = dir.existsSync() ? dir.listSync().whereType<File>().toList() : <File>[];
  ByteData bytes(File f) => ByteData.sublistView(Uint8List.fromList(f.readAsBytesSync()));
  final roboto = FontLoader('Roboto');
  final icons = FontLoader('MaterialIcons');
  var r = 0, i = 0;
  for (final f in files) {
    final name = f.uri.pathSegments.last;
    if (name.startsWith('Roboto-') && name.endsWith('.ttf')) {
      roboto.addFont(Future.value(bytes(f)));
      r++;
    } else if (name.startsWith('MaterialIcons-Regular')) {
      icons.addFont(Future.value(bytes(f)));
      i++;
    }
  }
  if (r == 0 || i == 0) fail('Polices Roboto ($r) ou MaterialIcons ($i) introuvables dans ${dir.path}.');
  await roboto.load();
  await icons.load();
}

final _challenge = Challenge(
  challengeId: '00000000-0000-7000-8000-000000000000',
  channel: 'phone',
  destination: '+225 07 •• •• •• 12',
  expiresAt: DateTime.now().add(const Duration(minutes: 10)),
  resendAvailableAt: DateTime.now().add(const Duration(seconds: 45)),
);

Future<ProviderContainer> _show(WidgetTester tester, String location, {ThemeMode mode = ThemeMode.light, Size physical = const Size(1170, 2532)}) async {
  tester.view.physicalSize = physical;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final storage = _NoTokens();
  final client = ApiClient(storage: storage, onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');
  final container = ProviderContainer(overrides: [
    tokenStorageProvider.overrideWithValue(storage),
    apiClientProvider.overrideWithValue(client),
    authApiProvider.overrideWithValue(_FakeAuthApi(client)),
    projectsApiProvider.overrideWithValue(_FakeProjectsApi(client)),
    accountApiProvider.overrideWithValue(_FakeAccountApi(client)),
    notificationPreferencesApiProvider.overrideWithValue(_FakeNotificationPreferencesApi(client)),
    inboxApiProvider.overrideWithValue(_FakeInboxApi(client)),
    peniApiProvider.overrideWithValue(_FakePeniApi(client)),
    socialApiProvider.overrideWithValue(_FakeSocialApi(client)),
    merchantApiProvider.overrideWithValue(_FakeMerchantApi(client)),
    shopApiProvider.overrideWithValue(_FakeShopApi(client)),
    bimShopApiProvider.overrideWithValue(_FakeBimShopApi(client)),
    offersApiProvider.overrideWithValue(_FakeOffersApi(client)),
    messagingApiProvider.overrideWithValue(_FakeMessagingApi(client)),
  ],);
  addTearDown(container.dispose);
  final router = GoRouter(initialLocation: location, routes: [
    GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
    GoRoute(path: '/welcome', builder: (_, __) => const WelcomeScreen()),
    GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
    GoRoute(path: '/register/1', builder: (_, __) => const RegisterStep1Screen()),
    GoRoute(path: '/register/2', builder: (_, __) => const RegisterStep2Screen()),
    GoRoute(path: '/verify', builder: (_, __) => VerifyCodeScreen(challenge: _challenge)),
    GoRoute(path: '/forgot', builder: (_, __) => const ForgotPasswordScreen()),
    GoRoute(path: '/home', builder: (_, __) => const HomeShell()),
    GoRoute(path: '/account', builder: (_, __) => const AccountScreen()),
    GoRoute(path: '/account/contacts', builder: (_, __) => const ContactsScreen()),
    GoRoute(path: '/account/password', builder: (_, __) => const ChangePasswordScreen()),
    GoRoute(path: '/account/devices', builder: (_, __) => const DevicesScreen()),
    GoRoute(path: '/account/reminders', builder: (_, __) => const ReminderPreferencesScreen()),
    GoRoute(path: '/notifications', builder: (_, __) => NotificationsScreen(now: _FakeInboxApi.now)),
    GoRoute(path: '/projects', builder: (_, __) => const MyProjectsScreen()),
    GoRoute(path: '/projects/new', builder: (_, __) => const NewProjectScreen()),
    GoRoute(path: '/peni/new-project', builder: (_, __) => const PeniChatScreen()),
    GoRoute(path: '/projects/p1', builder: (_, __) => const ProjectMapScreen(projectId: 'p1')),
    GoRoute(path: '/projects/p1/program', builder: (_, __) => const ProgramScreen(projectId: 'p1')),
    GoRoute(path: '/projects/p3/done', builder: (_, __) => const CelebrationScreen(projectId: 'p3')),
    GoRoute(path: '/projects/p1/transformation', builder: (_, __) => const TransformationScreen(projectId: 'p1')),
    GoRoute(path: '/projects/p1/reports', builder: (_, __) => const ReportsScreen(projectId: 'p1')),
    GoRoute(path: '/reports', builder: (_, __) => const ReportsScreen()),
    GoRoute(path: '/projects/p1/today', builder: (_, __) => ProjectDayScreen(projectId: 'p1', day: _FakeProjectsApi.iso(0))),
    GoRoute(path: '/posts/p1', builder: (_, __) => const PostDetailScreen(postId: 'p1')),
    GoRoute(path: '/people/yannick.doho', builder: (_, __) => const ProfileScreen(username: 'yannick.doho')),
    GoRoute(path: '/social/new', builder: (_, __) => const ComposerScreen()),
    GoRoute(path: '/merchant/apply', builder: (_, __) => const MerchantApplyScreen()),
    GoRoute(path: '/shop', builder: (_, __) => const MerchantSpaceScreen()),
    GoRoute(path: '/shop/requests', builder: (_, __) => const ShopRequestsScreen()),
    GoRoute(path: '/messages-tab', builder: (_, __) => const Scaffold(body: SafeArea(child: MessagesView()))),
    GoRoute(path: '/messages/c1', builder: (_, __) => const ConversationScreen(conversationId: 'c1', refreshEvery: null)),
    GoRoute(path: '/projects/p1/offers', builder: (_, __) => const ProjectOffersScreen(projectId: 'p1')),
    GoRoute(path: '/bimshop/categories', builder: (_, __) => const RubriquesScreen()),
    GoRoute(path: '/bimshop/products/x1', builder: (_, __) => const ShopProductScreen(productId: 'x1')),
    GoRoute(path: '/bimshop/shops/boutique-elegance', builder: (_, __) => const ShopProfileScreen(slug: 'boutique-elegance')),
    GoRoute(path: '/shop/products/x1', builder: (_, __) => const ProductEditorScreen(productId: 'x1')),
  ],);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp.router(
      debugShowCheckedModeBanner: false,
      theme: BimTheme.light(),
      darkTheme: BimTheme.dark(),
      themeMode: mode,
      routerConfig: router,
      locale: const Locale('fr'),
      supportedLocales: const [Locale('fr')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
    ),
  ),);
  await _settle(tester);
  return container;
}

/// Laisse le temps aux SVG (chargés hors du fil principal) et aux futures de se terminer, sans attendre
/// la fin des animations infinies (indicateur de chargement).
Future<void> _settle(WidgetTester tester) async {
  for (var k = 0; k < 6; k++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 150)));
    await tester.pump(const Duration(milliseconds: 400));
  }
}

Future<void> _capture(WidgetTester tester, String name) =>
    expectLater(find.byType(MaterialApp), matchesGoldenFile('captures/$name.png'));

void main() {
  setUpAll(_loadSdkFonts);

  testWidgets('01 splash', (t) async {
    await _show(t, '/splash');
    await _capture(t, '01_splash');
  });
  testWidgets('02 bienvenue', (t) async {
    await _show(t, '/welcome');
    await _capture(t, '02_bienvenue');
  });
  testWidgets('03 connexion', (t) async {
    await _show(t, '/login');
    await _capture(t, '03_connexion');
  });
  testWidgets('04 inscription', (t) async {
    await _show(t, '/register/1');
    await _capture(t, '04_inscription');
  });
  testWidgets('05 centres d’intérêt', (t) async {
    await _show(t, '/register/2');
    await _capture(t, '05_interets');
  });
  testWidgets('06 visiteur', (t) async {
    final c = await _show(t, '/home');
    c.read(sessionProvider.notifier).continueAsVisitor();
    await t.pump();
    await t.tap(find.byIcon(Icons.add).last);
    await _settle(t);
    await _capture(t, '06_visiteur');
  });
  testWidgets('ajout D-UI-03 : saisie du code', (t) async {
    await _show(t, '/verify');
    await _capture(t, 'x1_code');
  });
  testWidgets('ajout D-UI-03 : mot de passe oublié', (t) async {
    await _show(t, '/forgot');
    await _capture(t, 'x2_mot_de_passe_oublie');
  });
  // Petit téléphone (320 × 568, la largeur de l'émulateur de la CI) : un débordement ferait échouer ce test.
  testWidgets('04 inscription, petit écran', (t) async {
    await _show(t, '/register/1', physical: const Size(960, 1704));
    await _capture(t, 'x4_inscription_petit_ecran');
  });
  testWidgets('03 connexion, petit écran', (t) async {
    await _show(t, '/login', physical: const Size(960, 1704));
    await _capture(t, 'x5_connexion_petit_ecran');
  });
  for (final (route, name) in [('/welcome', '02'), ('/register/2', '05'), ('/verify', 'code'), ('/forgot', 'oubli'), ('/home', 'accueil')]) {
    testWidgets('$name, petit écran', (t) async {
      await _show(t, route, physical: const Size(960, 1704));
      await _capture(t, 'x6_petit_ecran_$name');
    });
  }

  testWidgets('18 mes projets', (t) async {
    await _show(t, '/projects');
    await _capture(t, '18_mes_projets');
  });
  testWidgets('19 à 23 nouveau projet', (t) async {
    await _show(t, '/projects/new');
    await t.tap(find.text('Mode Premium'));
    await t.pump();
    await t.tap(find.text('Moyen'));
    await _settle(t);
    await _capture(t, '19_np_mode');
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Sport'));
    await _settle(t);
    await _capture(t, '20_np_categorie');
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Perte de poids'));
    await _settle(t);
    await _capture(t, '21_np_objectif');
    await t.tap(find.text('Continuer'));
    await _settle(t);
    await _capture(t, '22_np_photo');
    await t.tap(find.text('Passer cette étape'));
    await _settle(t);
    await _capture(t, '23_np_questions');
  });
  testWidgets('20 et 23, petit écran', (t) async {
    await _show(t, '/projects/new', physical: const Size(960, 1704));
    await t.tap(find.text('Mode Éco'));
    await t.pump();
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Sport'));
    await _settle(t);
    await _capture(t, 'x8_petit_ecran_20');
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Abdos'));
    await t.pump();
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Passer cette étape'));
    await _settle(t);
    await _capture(t, 'x8_petit_ecran_23');
  });
  testWidgets('24 programme', (t) async {
    await _show(t, '/projects/p1/program');
    await _capture(t, '24_np_plan');
  });
  testWidgets('24 Peni explique une tâche', (t) async {
    await _show(t, '/projects/p1/program');
    await t.ensureVisible(find.text('Demander à Peni').first);
    await _settle(t);
    await t.tap(find.text('Demander à Peni').first);
    await _settle(t);
    expect(find.byKey(const ValueKey('peni-explain-intro')), findsOneWidget);
    await _capture(t, '24_peni_explication');
  });
  testWidgets('26 carte du projet', (t) async {
    await _show(t, '/projects/p1');
    await _capture(t, '26_projet_carte');
  });
  testWidgets('27 journée', (t) async {
    await _show(t, '/projects/p1/today');
    await _capture(t, '27_projet_jour');
  });
  testWidgets('29 pause', (t) async {
    await _show(t, '/projects/p1/today');
    await t.tap(find.text('Pause'));
    await _settle(t);
    await _capture(t, '29_pause');
  });
  testWidgets('31 transformation (sans photo)', (t) async {
    await _show(t, '/projects/p1/transformation');
    await _capture(t, '31_avant_apres');
  });
  testWidgets('signalements', (t) async {
    await _show(t, '/projects/p1/reports');
    await _capture(t, 'x10_signalements');
  });
  testWidgets('26 coffre ouvert', (t) async {
    await _show(t, '/projects/p1');
    await t.tap(find.byKey(const ValueKey('chest-1')));
    await _settle(t);
    await _capture(t, 'x14_coffre');
  });
  testWidgets('mes signalements (tous)', (t) async {
    await _show(t, '/reports');
    await _capture(t, 'x12_mes_signalements');
  });
  testWidgets('21 résoudre un problème', (t) async {
    await _show(t, '/reports');
    await t.tap(find.text('Signaler un nouveau problème'));
    await _settle(t);
    await _capture(t, 'x13_resoudre_un_probleme');
  });
  testWidgets('27 signaler', (t) async {
    await _show(t, '/projects/p1/today');
    await t.tap(find.text('Signaler'));
    await _settle(t);
    await _capture(t, 'x11_signaler');
  });
  testWidgets('30 fin du programme', (t) async {
    await _show(t, '/projects/p3/done');
    await _capture(t, '30_celebration');
  });
  for (final (route, name) in [('/projects', '18'), ('/projects/new', '19'), ('/projects/p1', '26'), ('/projects/p1/today', '27'), ('/projects/p1/program', '24'), ('/projects/p3/done', '30'), ('/projects/p1/transformation', '31')]) {
    testWidgets('$name projets, petit écran', (t) async {
      await _show(t, route, physical: const Size(960, 1704));
      await _capture(t, 'x7_petit_ecran_$name');
    });
  }

  Future<void> signedIn(WidgetTester t, String route, {Size physical = const Size(1170, 2532)}) async {
    final c = await _show(t, route, physical: physical);
    await c.read(sessionProvider.notifier).completeSignIn(
      (tokens: const Tokens(accessToken: 'a', refreshToken: 'r'), me: Me.fromJson(_demoMe)),
    );
    await _settle(t);
  }

  for (final (route, name) in [('/account', '62_parametres'), ('/account/contacts', 'x9_coordonnees'), ('/account/password', 'x9_mot_de_passe'), ('/account/devices', 'x9_appareils'), ('/account/reminders', 'x15_rappels'), ('/notifications', '17_notifications')]) {
    testWidgets('compte : $name', (t) async {
      await signedIn(t, route);
      await _capture(t, name);
    });
    testWidgets('compte : $name, petit écran', (t) async {
      await signedIn(t, route, physical: const Size(960, 1704));
      await _capture(t, '${name}_petit');
    });
  }
  testWidgets('53 changer de profil', (t) async {
    await signedIn(t, '/account');
    await t.tap(find.text('Changer de profil'));
    await _settle(t);
    await _capture(t, '53_changer_profil');
  });
  testWidgets('25 discussion avec Peni', (t) async {
    await _show(t, '/peni/new-project');
    await _capture(t, '25_peni');
  });
  testWidgets('25 discussion avec Peni (sombre, petit écran)', (t) async {
    await _show(t, '/peni/new-project', mode: ThemeMode.dark, physical: const Size(960, 1704));
    await _capture(t, '25_peni_sombre_petit');
  });
  testWidgets('rappels (sombre)', (t) async {
    await _show(t, '/account/reminders', mode: ThemeMode.dark);
    await _capture(t, 'x15_rappels_sombre');
  });
  // Lot 4 — social (écrans 10, 11, 12, 16, 52, 63).
  Future<void> signIn(ProviderContainer c) => c.read(sessionProvider.notifier).completeSignIn((
        tokens: const Tokens(accessToken: 'a', refreshToken: 'r'),
        me: const Me(id: 'u0', fullName: 'Doho Yannick', username: 'yannick.doho', city: 'Abidjan', theme: 'system', contacts: []),
      ),);
  testWidgets('10 accueil (fil)', (t) async {
    final c = await _show(t, '/home');
    await signIn(c);
    await _settle(t);
    await _capture(t, '10_accueil');
  });
  testWidgets('63 accueil sombre (fil)', (t) async {
    final c = await _show(t, '/home', mode: ThemeMode.dark);
    await signIn(c);
    await _settle(t);
    await _capture(t, '63_accueil_sombre');
  });
  testWidgets('11 publication', (t) async {
    await _show(t, '/posts/p1');
    await _capture(t, '11_bim_post');
  });
  testWidgets('12 commentaires', (t) async {
    await _show(t, '/posts/p1');
    await t.tap(find.byKey(const ValueKey('comments-p1')));
    await _settle(t);
    await _capture(t, '12_commentaires');
  });
  testWidgets('16 nouveau Bim', (t) async {
    final c = await _show(t, '/social/new');
    await signIn(c);
    await _settle(t);
    await _capture(t, '16_partager');
  });
  testWidgets('52 profil', (t) async {
    await _show(t, '/people/yannick.doho');
    await _capture(t, '52_profil_user');
  });
  testWidgets('10 accueil, petit écran', (t) async {
    final c = await _show(t, '/home', physical: const Size(960, 1704));
    await signIn(c);
    await _settle(t);
    await _capture(t, 'x16_petit_ecran_fil');
  });
  testWidgets('07 vérification marchand', (t) async {
    await _show(t, '/merchant/apply');
    await _capture(t, '07_verif_marchand');
  });
  testWidgets('32 BimShop', (t) async {
    await _show(t, '/home');
    await t.tap(find.text('BimShop'));
    await _settle(t);
    await _capture(t, '32_bimshop');
  });
  testWidgets('33 rubriques', (t) async {
    await _show(t, '/bimshop/categories');
    await t.tap(find.text('Vêtements'));
    await _settle(t);
    await _capture(t, '33_rubriques');
  });
  testWidgets('34 fiche article', (t) async {
    await _show(t, '/bimshop/products/x1');
    await _capture(t, '34_fiche_article');
  });
  testWidgets('54 profil boutique', (t) async {
    await _show(t, '/bimshop/shops/boutique-elegance');
    await _capture(t, '54_profil_boutique');
  });
  testWidgets('47 messages', (t) async {
    await _show(t, '/messages-tab');
    await _capture(t, '47_messages');
  });
  testWidgets('47 conversation', (t) async {
    await _show(t, '/messages/c1');
    await _capture(t, 'x20_conversation');
  });
  testWidgets('49 offres du projet', (t) async {
    await _show(t, '/projects/p1/offers');
    await _capture(t, '49_offres_projet');
  });
  testWidgets('55 demandes de projet (marchand)', (t) async {
    await _show(t, '/shop/requests');
    await _capture(t, 'x19_demandes_marchand');
  });
  testWidgets('55 espace marchand', (t) async {
    await _show(t, '/shop');
    await _capture(t, '55_espace_marchand');
  });
  testWidgets('55 article (modification)', (t) async {
    await _show(t, '/shop/products/x1');
    await _capture(t, 'x17_article');
  });
  testWidgets('55 espace marchand (sombre)', (t) async {
    await _show(t, '/shop', mode: ThemeMode.dark);
    await _capture(t, 'x18_espace_marchand_sombre');
  });
  testWidgets('accueil visiteur (sombre)', (t) async {
    final c = await _show(t, '/home', mode: ThemeMode.dark);
    c.read(sessionProvider.notifier).continueAsVisitor();
    await _settle(t);
    await _capture(t, 'x3_accueil_sombre');
  });
}
