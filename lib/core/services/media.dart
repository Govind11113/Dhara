import 'dart:io';

import 'package:appwrite/appwrite.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';

import '../config/env.dart';
import '../utils/phash.dart';
import 'appwrite.dart';

/// A processed photo, ready to upload.
class ProcessedPhoto {
  const ProcessedPhoto({
    required this.bytes,
    required this.phash,
    required this.width,
    required this.height,
  });

  final Uint8List bytes;
  final String phash;
  final int width;
  final int height;

  int get sizeKb => (bytes.lengthInBytes / 1024).round();
}

class UploadedPhoto {
  const UploadedPhoto({required this.fileId, required this.phash});

  final String fileId;
  final String phash;
}

/// Arguments for the isolate. Only sendable types.
class _ProcessArgs {
  const _ProcessArgs(this.bytes, this.maxEdge, this.quality);

  final Uint8List bytes;
  final int maxEdge;
  final int quality;
}

/// Runs on a background isolate: decode, downscale, re-encode, hash.
///
/// A 12 MP capture is ~4 MB and takes a noticeable moment to decode, so doing
/// this on the UI isolate would drop frames mid-flow.
ProcessedPhoto _processPhoto(_ProcessArgs args) {
  final decoded = img.decodeImage(args.bytes);
  if (decoded == null) {
    throw const FormatException('Could not read that photo.');
  }

  // The pHash is computed from the resized image so the value is stable
  // regardless of the device's capture resolution.
  final longest = decoded.width > decoded.height ? decoded.width : decoded.height;
  final resized = longest > args.maxEdge
      ? img.copyResize(
          decoded,
          width: decoded.width >= decoded.height ? args.maxEdge : null,
          height: decoded.height > decoded.width ? args.maxEdge : null,
          interpolation: img.Interpolation.average,
        )
      : decoded;

  final jpeg = Uint8List.fromList(img.encodeJpg(resized, quality: args.quality));

  return ProcessedPhoto(
    bytes: jpeg,
    phash: PHash.ofBytes(jpeg),
    width: resized.width,
    height: resized.height,
  );
}

/// Photo processing and upload.
///
/// Photos are always captured in-app through the camera, never picked from the
/// gallery. That single constraint removes the easiest cheat (downloading a
/// picture of a tree), and the perceptual hash catches the rest.
class MediaService {
  MediaService(this._ref);

  final Ref _ref;

  Future<ProcessedPhoto> process(
    String path, {
    int maxEdge = 1440,
    int quality = 82,
  }) async {
    final file = File(path);
    if (!await file.exists()) {
      throw const FormatException('That photo is no longer available.');
    }
    final raw = await file.readAsBytes();
    return compute(_processPhoto, _ProcessArgs(raw, maxEdge, quality));
  }

  /// Uploads to a private bucket, granting read access to the owner only.
  Future<UploadedPhoto> upload({
    required ProcessedPhoto photo,
    required String userId,
    String bucketId = Buckets.treePhotos,
    String prefix = 'tree',
    void Function(double progress)? onProgress,
  }) async {
    // InputFile.fromBytes keeps the upload in memory; no temp file to clean up.
    final file = await _ref.read(storageProvider).createFile(
          bucketId: bucketId,
          fileId: ID.unique(),
          file: InputFile.fromBytes(
            bytes: photo.bytes,
            filename: '${prefix}_${DateTime.now().millisecondsSinceEpoch}.jpg',
            contentType: 'image/jpeg',
          ),
          permissions: [Permission.read(Role.user(userId))],
          // UploadProgress.progress is a 0-100 percentage.
          onProgress: onProgress == null
              ? null
              : (p) => onProgress((p.progress / 100).clamp(0.0, 1.0)),
        );

    return UploadedPhoto(fileId: file.$id, phash: photo.phash);
  }

  /// Convenience: process then upload in one call.
  Future<UploadedPhoto> processAndUpload({
    required String path,
    required String userId,
    String bucketId = Buckets.treePhotos,
    String prefix = 'tree',
    int maxEdge = 1440,
  }) async {
    final processed = await process(path, maxEdge: maxEdge);
    return upload(
      photo: processed,
      userId: userId,
      bucketId: bucketId,
      prefix: prefix,
    );
  }

  /// Fetches file bytes for display. Buckets are private, so an authenticated
  /// SDK call is required rather than a plain image URL.
  Future<Uint8List> view({
    required String fileId,
    String bucketId = Buckets.treePhotos,
  }) =>
      _ref.read(storageProvider).getFileView(bucketId: bucketId, fileId: fileId);

  /// Caches a viewed file on disk so revisiting a tree does not re-download it.
  Future<File> cached({
    required String fileId,
    String bucketId = Buckets.treePhotos,
  }) async {
    final dir = await getApplicationCacheDirectory();
    final file = File('${dir.path}/${bucketId}_$fileId.jpg');
    if (await file.exists()) return file;

    final bytes = await view(fileId: fileId, bucketId: bucketId);
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }
}

final mediaServiceProvider = Provider<MediaService>((ref) => MediaService(ref));

/// Loads a private bucket image, cached on disk. Keyed by "bucket/fileId".
final photoBytesProvider =
    FutureProvider.family<Uint8List, String>((ref, key) async {
  final slash = key.indexOf('/');
  final bucketId = slash > 0 ? key.substring(0, slash) : Buckets.treePhotos;
  final fileId = slash > 0 ? key.substring(slash + 1) : key;

  final file = await ref
      .read(mediaServiceProvider)
      .cached(fileId: fileId, bucketId: bucketId);
  return file.readAsBytes();
});
