import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

/// Source des photos avant / après : appareil photo ou galerie du téléphone.
/// Remplaçable dans les tests (le sélecteur du système ne peut pas être piloté par un test automatique).
abstract class PhotoSource {
  Future<List<int>?> pick({required bool camera});
}

class DevicePhotoSource implements PhotoSource {
  final _picker = ImagePicker();

  @override
  Future<List<int>?> pick({required bool camera}) async {
    final file = await _picker.pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 2000,
      maxHeight: 2000,
      imageQuality: 85,
      requestFullMetadata: false,
    );
    return file?.readAsBytes();
  }
}

final photoSourceProvider = Provider<PhotoSource>((ref) => DevicePhotoSource());
