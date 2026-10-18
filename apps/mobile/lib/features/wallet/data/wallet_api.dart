import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Lot 9 (prototype) — Premium, pièces, envois et retraits. 1 pièce = 1 F ; commission BIM : 0.
/// Toutes les règles (Premium exigé pour recevoir, seules les pièces reçues se retirent, plafonds) sont appliquées par
/// l'API. Prototype : achats et retraits **simulés** (mode démonstration), aucun argent réel.

int _int(Object? v) => v is num ? v.toInt() : 0;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
List<Map<String, dynamic>> _list(Object? v) => v is List<dynamic> ? v.whereType<Map<String, dynamic>>().toList() : const [];

class WalletBalance {
  const WalletBalance({required this.total, required this.purchased, required this.received, required this.withdrawable});

  final int total;
  final int purchased;
  final int received;
  final int withdrawable;

  factory WalletBalance.fromJson(Map<String, dynamic> j) =>
      WalletBalance(total: _int(j['total']), purchased: _int(j['purchased']), received: _int(j['received']), withdrawable: _int(j['withdrawable']));
}

class GiftOption {
  const GiftOption({required this.code, required this.name, required this.coins});

  final String code;
  final String name;
  final int coins;

  factory GiftOption.fromJson(Map<String, dynamic> j) => GiftOption(code: (j['code'] ?? '') as String, name: (j['name'] ?? '') as String, coins: _int(j['coins']));
}

class WithdrawalRules {
  const WithdrawalRules({required this.min, required this.dailyCap, required this.instantMax, required this.feePercent, required this.operators});

  final int min;
  final int dailyCap;
  final int instantMax;
  final double feePercent;
  final List<String> operators;

  /// Frais de l'opérateur (arrondis au franc supérieur), à la charge de la personne.
  int feeFor(int coins) => (coins * feePercent / 100).ceil();

  factory WithdrawalRules.fromJson(Map<String, dynamic> j) => WithdrawalRules(
        min: _int(j['min']),
        dailyCap: _int(j['dailyCap']),
        instantMax: _int(j['instantMax']),
        feePercent: j['feePercent'] is num ? (j['feePercent'] as num).toDouble() : 0,
        operators: [for (final o in (j['operators'] is List<dynamic> ? j['operators'] as List<dynamic> : const <dynamic>[])) '$o'],
      );
}

class WithdrawalItem {
  const WithdrawalItem({required this.id, required this.coins, required this.feeFcfa, required this.netFcfa, required this.operator, required this.status, this.reviewReason, this.rejectReason, this.at});

  final String id;
  final int coins;
  final int feeFcfa;
  final int netFcfa;
  final String operator;

  /// review · paid · rejected
  final String status;
  final String? reviewReason;
  final String? rejectReason;
  final DateTime? at;

  factory WithdrawalItem.fromJson(Map<String, dynamic> j) => WithdrawalItem(
        id: (j['id'] ?? '') as String,
        coins: _int(j['coins']),
        feeFcfa: _int(j['feeFcfa']),
        netFcfa: _int(j['netFcfa']),
        operator: (j['operator'] ?? '') as String,
        status: (j['status'] ?? '') as String,
        reviewReason: j['reviewReason'] as String?,
        rejectReason: j['rejectReason'] as String?,
        at: _date(j['at']),
      );
}

class LedgerLine {
  const LedgerLine({required this.id, required this.kind, required this.delta, this.at});

  final String id;

  /// purchase · gift_sent · gift_received · withdrawal · withdrawal_refund
  final String kind;
  final int delta;
  final DateTime? at;

  factory LedgerLine.fromJson(Map<String, dynamic> j) => LedgerLine(id: (j['id'] ?? '') as String, kind: (j['kind'] ?? '') as String, delta: _int(j['delta']), at: _date(j['at']));
}

class WalletInfo {
  const WalletInfo({
    required this.available,
    required this.demo,
    required this.balance,
    required this.premiumActive,
    required this.receivedTotal,
    required this.sentTotal,
    required this.packs,
    required this.gifts,
    required this.rules,
    this.premiumUntil,
    this.history = const [],
    this.withdrawals = const [],
  });

  final bool available;
  final bool demo;
  final WalletBalance balance;
  final bool premiumActive;
  final DateTime? premiumUntil;
  final int receivedTotal;
  final int sentTotal;
  final List<int> packs;
  final List<GiftOption> gifts;
  final WithdrawalRules rules;
  final List<LedgerLine> history;
  final List<WithdrawalItem> withdrawals;

  factory WalletInfo.fromJson(Map<String, dynamic> j) {
    final premium = j['premium'] is Map<String, dynamic> ? j['premium'] as Map<String, dynamic> : const <String, dynamic>{};
    final stats = j['stats'] is Map<String, dynamic> ? j['stats'] as Map<String, dynamic> : const <String, dynamic>{};
    return WalletInfo(
      available: (j['available'] ?? false) as bool,
      demo: (j['demo'] ?? false) as bool,
      balance: WalletBalance.fromJson(j['balance'] is Map<String, dynamic> ? j['balance'] as Map<String, dynamic> : const {}),
      premiumActive: (premium['active'] ?? false) as bool,
      premiumUntil: _date(premium['until']),
      receivedTotal: _int(stats['receivedTotal']),
      sentTotal: _int(stats['sentTotal']),
      packs: [for (final p in _list(j['packs'])) _int(p['coins'])],
      gifts: [for (final g in _list(j['gifts'])) GiftOption.fromJson(g)],
      rules: WithdrawalRules.fromJson(j['withdrawal'] is Map<String, dynamic> ? j['withdrawal'] as Map<String, dynamic> : const {}),
      history: [for (final l in _list(j['history'])) LedgerLine.fromJson(l)],
      withdrawals: [for (final w in _list(j['withdrawals'])) WithdrawalItem.fromJson(w)],
    );
  }
}

class PremiumInfo {
  const PremiumInfo({required this.available, required this.demo, required this.priceFcfa, required this.periodDays, required this.active, required this.autoRenew, this.until});

  final bool available;
  final bool demo;
  final int priceFcfa;
  final int periodDays;
  final bool active;
  final bool autoRenew;
  final DateTime? until;

  factory PremiumInfo.fromJson(Map<String, dynamic> j) => PremiumInfo(
        available: (j['available'] ?? false) as bool,
        demo: (j['demo'] ?? false) as bool,
        priceFcfa: _int(j['priceFcfa']),
        periodDays: _int(j['periodDays']),
        active: (j['active'] ?? false) as bool,
        autoRenew: (j['autoRenew'] ?? false) as bool,
        until: _date(j['until']),
      );
}

class GiftResult {
  const GiftResult({required this.targetCoinCount, required this.balance});

  final int targetCoinCount;
  final WalletBalance balance;
}

class Donor {
  const Donor({required this.fullName, required this.username, required this.coins});

  final String fullName;
  final String username;
  final int coins;
}

class DonorsInfo {
  const DonorsInfo({required this.total, required this.donors, required this.anonymousCoins});

  final int total;
  final List<Donor> donors;
  final int anonymousCoins;
}

class WalletApi {
  WalletApi(this._api);
  final ApiClient _api;

  Future<WalletInfo> wallet() async => WalletInfo.fromJson(await _api.get('/v1/wallet'));

  Future<PremiumInfo> premium() async => PremiumInfo.fromJson(await _api.get('/v1/premium'));

  Future<PremiumInfo> subscribe() async => PremiumInfo.fromJson(await _api.post('/v1/premium/subscribe', body: {'channel': 'demo'}));

  Future<PremiumInfo> cancelPremium() async => PremiumInfo.fromJson(await _api.post('/v1/premium/cancel'));

  Future<WalletBalance> buy(int coins, {required String idempotencyKey}) async {
    final r = await _api.post('/v1/wallet/purchases', body: {'coins': coins, 'channel': 'demo', 'idempotencyKey': idempotencyKey});
    return WalletBalance.fromJson(r['balance'] as Map<String, dynamic>);
  }

  Future<GiftResult> gift({required String targetType, required String targetId, required String giftCode, required int quantity, required bool anonymous, required String idempotencyKey}) async {
    final r = await _api.post(
      '/v1/coins/gifts',
      body: {'targetType': targetType, 'targetId': targetId, 'giftCode': giftCode, 'quantity': quantity, 'anonymous': anonymous, 'idempotencyKey': idempotencyKey},
    );
    return GiftResult(targetCoinCount: _int(r['targetCoinCount']), balance: WalletBalance.fromJson(r['balance'] as Map<String, dynamic>));
  }

  /// Retrait : confirmation d'identité (mot de passe + code) à usage unique, portée « withdrawal ».
  Future<WithdrawalItem> withdraw(int coins, {required String operator, required String idempotencyKey, required String stepUpToken}) async {
    final r = await _api.post(
      '/v1/wallet/withdrawals',
      body: {'coins': coins, 'operator': operator, 'idempotencyKey': idempotencyKey},
      headers: {'X-Step-Up-Token': stepUpToken},
    );
    return WithdrawalItem.fromJson(r['withdrawal'] as Map<String, dynamic>);
  }

  Future<DonorsInfo> donors(String postId) async {
    final r = await _api.get('/v1/posts/$postId/donors');
    return DonorsInfo(
      total: _int(r['total']),
      anonymousCoins: _int(r['anonymousCoins']),
      donors: [
        for (final d in _list(r['donors']))
          Donor(
            fullName: ((d['user'] as Map<String, dynamic>?)?['fullName'] ?? '') as String,
            username: ((d['user'] as Map<String, dynamic>?)?['username'] ?? '') as String,
            coins: _int(d['coins']),
          ),
      ],
    );
  }
}

final walletApiProvider = Provider<WalletApi>((ref) => WalletApi(ref.watch(apiClientProvider)));
final walletProvider = FutureProvider.autoDispose<WalletInfo>((ref) => ref.watch(walletApiProvider).wallet());
final premiumProvider = FutureProvider.autoDispose<PremiumInfo>((ref) => ref.watch(walletApiProvider).premium());

/// Nombre avec espaces (« 10 000 »).
String coinsLabel(int n) => n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ' ');

const operatorLabels = {'orange': 'Orange Money', 'mtn': 'MTN MoMo', 'moov': 'Moov Money', 'wave': 'Wave'};

/// Image du cadeau (assets/gifts), d'après son code.
String? giftAsset(String code) => const {
      'coin1': 'assets/gifts/gift_coin1.svg',
      'coin5': 'assets/gifts/gift_coin5.svg',
      'purse': 'assets/gifts/gift_purse.svg',
      'chest_s': 'assets/gifts/gift_chest_s.svg',
      'chest_l': 'assets/gifts/gift_chest_l.svg',
      'safe': 'assets/gifts/gift_safe.svg',
      'bank': 'assets/gifts/gift_bank.svg',
      'ship': 'assets/gifts/gift_ship.svg',
    }[code];
