import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/network/api_client.dart';
import '../../../core/util/picker_guard.dart';
import '../../auth/data/models.dart';

/// Demande d'ouverture de boutique (lot 5-A, écrans 07 à 09).
class MerchantApplication {
  const MerchantApplication({
    required this.id,
    required this.status,
    required this.shopName,
    required this.city,
    required this.identity,
    required this.selfie,
    required this.payout,
    required this.address,
    required this.ready,
    this.commune,
    this.description,
    this.idDocType,
    this.idFront = false,
    this.idBack = false,
    this.payoutOperator,
    this.payoutPhoneEnd,
    this.addressText,
    this.rejectionReason,
  });

  final String id;

  /// draft · submitted · approved · rejected
  final String status;
  final String shopName;
  final String city;
  final String? commune;
  final String? description;
  final String? idDocType;
  final bool idFront;
  final bool idBack;
  final bool identity;
  final bool selfie;
  final bool payout;
  final bool address;
  final bool ready;
  final String? payoutOperator;
  final String? payoutPhoneEnd;
  final String? addressText;
  final String? rejectionReason;

  bool get editable => status == 'draft' || status == 'rejected';

  factory MerchantApplication.fromJson(Map<String, dynamic> j) {
    final shop = j['shop'] as Map<String, dynamic>;
    final docs = (j['documents'] ?? const <String, dynamic>{}) as Map<String, dynamic>;
    final check = (j['checklist'] ?? const <String, dynamic>{}) as Map<String, dynamic>;
    final payout = j['payout'] as Map<String, dynamic>?;
    return MerchantApplication(
      id: j['id'] as String,
      status: j['status'] as String,
      shopName: (shop['name'] ?? '') as String,
      city: (shop['city'] ?? '') as String,
      commune: shop['commune'] as String?,
      description: shop['description'] as String?,
      idDocType: j['idDocType'] as String?,
      idFront: (docs['idFront'] ?? false) as bool,
      idBack: (docs['idBack'] ?? false) as bool,
      identity: (check['identity'] ?? false) as bool,
      selfie: (check['selfie'] ?? false) as bool,
      payout: (check['payout'] ?? false) as bool,
      address: (check['address'] ?? false) as bool,
      ready: (j['ready'] ?? false) as bool,
      payoutOperator: payout?['operator'] as String?,
      payoutPhoneEnd: payout?['phoneEnd'] as String?,
      addressText: j['address'] as String?,
      rejectionReason: j['rejectionReason'] as String?,
    );
  }
}

class MerchantApi {
  MerchantApi(this._api);
  final ApiClient _api;

  /// Ma demande (null : aucune) et si le service est disponible sur ce serveur.
  Future<({MerchantApplication? application, bool available})> mine() async {
    final r = await _api.get('/v1/merchant/applications/mine');
    final a = r['application'];
    return (application: a is Map<String, dynamic> ? MerchantApplication.fromJson(a) : null, available: (r['available'] ?? false) as bool);
  }

  MerchantApplication _app(Map<String, dynamic> r) => MerchantApplication.fromJson(r['application'] as Map<String, dynamic>);

  Future<MerchantApplication> create({required String name, required String city, String? commune, String? description}) async => _app(
        await _api.post('/v1/merchant/applications', body: {
          'name': name,
          'city': city,
          if (commune != null && commune.isNotEmpty) 'commune': commune,
          if (description != null && description.isNotEmpty) 'description': description,
        },),
      );

  Future<MerchantApplication> update(String id, {String? idDocType, String? address}) async =>
      _app(await _api.patch('/v1/merchant/applications/$id', body: {if (idDocType != null) 'idDocType': idDocType, if (address != null) 'address': address}));

  Future<MerchantApplication> upload(String id, String kind, List<int> bytes) async {
    final png = bytes.length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50;
    return _app(
      await _api.upload('/v1/merchant/applications/$id/documents/$kind', field: 'photo', bytes: bytes, filename: png ? '$kind.png' : '$kind.jpg', contentType: png ? 'image/png' : 'image/jpeg', method: 'PUT'),
    );
  }

  Future<Challenge> startPayout(String id, {required String phone, required String operator}) async =>
      Challenge.fromJson((await _api.post('/v1/merchant/applications/$id/payout-number', body: {'phone': phone, 'operator': operator}))['challenge'] as Map<String, dynamic>);

  Future<MerchantApplication> verifyPayout(String id, {required String challengeId, required String code}) async =>
      _app(await _api.post('/v1/merchant/applications/$id/payout-number/verify', body: {'challengeId': challengeId, 'code': code}));

  Future<MerchantApplication> submit(String id) async => _app(await _api.post('/v1/merchant/applications/$id/submit'));

  Future<void> withdraw(String id) => _api.delete('/v1/merchant/applications/$id');
}

final merchantApiProvider = Provider<MerchantApi>((ref) => MerchantApi(ref.watch(apiClientProvider)));

final myApplicationProvider = FutureProvider.autoDispose<({MerchantApplication? application, bool available})>((ref) => ref.watch(merchantApiProvider).mine());

/// Photos de la demande : pièce d'identité (appareil arrière ou galerie) et selfie (appareil avant).
/// Remplaçable dans les tests (le sélecteur du système ne peut pas être piloté par un test automatique).
abstract class KycPhotoSource {
  Future<List<int>?> document({required bool camera});
  Future<List<int>?> selfie();
}

class DeviceKycPhotoSource implements KycPhotoSource {
  final _picker = ImagePicker();

  @override
  Future<List<int>?> document({required bool camera}) => guardPicker(
        () async => (await _picker.pickImage(source: camera ? ImageSource.camera : ImageSource.gallery, maxWidth: 2000, maxHeight: 2000, imageQuality: 88, requestFullMetadata: false))
            ?.readAsBytes(),
      );

  @override
  Future<List<int>?> selfie() => guardPicker(
        () async => (await _picker.pickImage(
          source: ImageSource.camera,
          preferredCameraDevice: CameraDevice.front,
          maxWidth: 1600,
          maxHeight: 1600,
          imageQuality: 88,
          requestFullMetadata: false,
        ))
            ?.readAsBytes(),
      );
}

final kycPhotoSourceProvider = Provider<KycPhotoSource>((ref) => DeviceKycPhotoSource());
