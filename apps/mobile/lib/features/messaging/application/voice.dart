import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:video_player/video_player.dart';

import '../../../core/theme/tokens.dart';

/// V1 — Messages vocaux : enregistrement sur le téléphone (AAC, fichier M4A), 2 minutes au plus (décision du
/// 18/10/2026), lecture avec le lecteur déjà utilisé pour les Reels. Aucun service payant.
const voiceMaxDuration = Duration(minutes: 2);

/// Enregistreur remplaçable (tests).
abstract class VoiceRecorder {
  /// Démarre ; `false` si l'autorisation du micro est refusée.
  Future<bool> start();

  /// Arrête et renvoie le fichier enregistré (supprimé du téléphone ensuite).
  Future<List<int>?> stop();

  Future<void> cancel();

  void dispose();
}

class DeviceVoiceRecorder implements VoiceRecorder {
  final _rec = AudioRecorder();

  @override
  Future<bool> start() async {
    if (!await _rec.hasPermission()) return false;
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/bim_vocal_${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _rec.start(const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 48000, sampleRate: 44100, numChannels: 1), path: path);
    return true;
  }

  @override
  Future<List<int>?> stop() async {
    final path = await _rec.stop();
    if (path == null) return null;
    final f = File(path);
    if (!f.existsSync()) return null;
    final bytes = await f.readAsBytes();
    await f.delete().catchError((Object _) => f);
    return bytes;
  }

  @override
  Future<void> cancel() => _rec.cancel();

  @override
  void dispose() => unawaited(_rec.dispose());
}

final voiceRecorderProvider = Provider.autoDispose<VoiceRecorder>((ref) {
  final r = DeviceVoiceRecorder();
  ref.onDispose(r.dispose);
  return r;
});

String formatVoiceDuration(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

/// Bulle d'un message vocal : lecture / pause, avancement, durée. Le lecteur n'est créé qu'au premier appui.
class VoiceMessageView extends StatefulWidget {
  const VoiceMessageView({super.key, required this.url, required this.durationMs, required this.color});

  final String? url;
  final int? durationMs;
  final Color color;

  @override
  State<VoiceMessageView> createState() => _VoiceMessageViewState();
}

class _VoiceMessageViewState extends State<VoiceMessageView> {
  VideoPlayerController? _player;
  bool _loading = false;
  bool _failed = false;

  @override
  void dispose() {
    _player?.removeListener(_tick);
    unawaited(_player?.dispose());
    super.dispose();
  }

  void _tick() {
    if (!mounted) return;
    final v = _player!.value;
    if (v.isInitialized && !v.isPlaying && v.position >= v.duration) unawaited(_player!.seekTo(Duration.zero));
    setState(() {});
  }

  Future<void> _toggle() async {
    final url = widget.url;
    if (url == null) return;
    var p = _player;
    if (p == null) {
      setState(() => _loading = true);
      p = VideoPlayerController.networkUrl(Uri.parse(url));
      try {
        await p.initialize();
      } catch (_) {
        await p.dispose();
        if (mounted) {
          setState(() {
            _loading = false;
            _failed = true;
          });
        }
        return;
      }
      if (!mounted) {
        await p.dispose();
        return;
      }
      p.addListener(_tick);
      setState(() {
        _player = p;
        _loading = false;
      });
    }
    p.value.isPlaying ? await p.pause() : await p.play();
  }

  @override
  Widget build(BuildContext context) {
    final v = _player?.value;
    final total = Duration(milliseconds: widget.durationMs ?? 0);
    final pos = v?.position ?? Duration.zero;
    final progress = total.inMilliseconds == 0 ? 0.0 : (pos.inMilliseconds / total.inMilliseconds).clamp(0.0, 1.0);
    final playing = v?.isPlaying ?? false;
    return SizedBox(
      width: 210,
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('voice-play'),
            tooltip: playing ? 'Pause' : 'Écouter',
            onPressed: _failed || widget.url == null ? null : _toggle,
            icon: _loading
                ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: widget.color))
                : Icon(_failed ? Icons.error_outline : (playing ? Icons.pause_rounded : Icons.play_arrow_rounded), color: widget.color),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(BimRadius.chip),
              child: LinearProgressIndicator(value: progress, minHeight: 4, color: widget.color, backgroundColor: widget.color.withValues(alpha: 0.25)),
            ),
          ),
          const SizedBox(width: BimSpacing.sm),
          Text(formatVoiceDuration(playing || pos > Duration.zero ? pos : total), style: TextStyle(color: widget.color, fontSize: 13)),
        ],
      ),
    );
  }
}
