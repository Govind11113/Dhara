import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/config/env.dart';
import '../core/services/api.dart';
import '../core/services/media.dart';
import 'auth_controller.dart';

/// Device and build details attached to a report.
///
/// Gathered on the client because the server cannot see any of it, and a bug
/// report without a version or a device model usually cannot be acted on.
/// Every lookup is best-effort: failing to read a model name must not stop a
/// user telling us something.
class _Context {
  const _Context({this.appVersion = '', this.platform = '', this.model = ''});

  final String appVersion;
  final String platform;
  final String model;
}

Future<_Context> _gather() async {
  var version = '';
  var platform = '';
  var model = '';

  try {
    final info = await PackageInfo.fromPlatform();
    version = '${info.version}+${info.buildNumber}';
  } catch (_) {
    // Not worth surfacing; the report is still useful without it.
  }

  try {
    final plugin = DeviceInfoPlugin();
    if (Platform.isAndroid) {
      platform = 'android';
      final android = await plugin.androidInfo;
      model = '${android.manufacturer} ${android.model} (SDK '
          '${android.version.sdkInt})';
    } else if (Platform.isIOS) {
      platform = 'ios';
      final ios = await plugin.iosInfo;
      model = '${ios.utsname.machine} (iOS ${ios.systemVersion})';
    } else {
      platform = Platform.operatingSystem;
    }
  } catch (_) {
    // Same again.
  }

  return _Context(appVersion: version, platform: platform, model: model);
}

class FeedbackController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  /// Sends a note to the team.
  ///
  /// An optional screenshot is uploaded first, the same way tree photos are,
  /// so the server only ever receives a file ID it can resolve. If the upload
  /// fails the message still goes — losing the whole report over an attachment
  /// would be the wrong trade.
  Future<void> submit({
    required String category,
    required String message,
    String? screenshotPath,
    String? refType,
    String? refId,
  }) async {
    final userId = ref.read(currentUserIdProvider);
    if (userId == null) {
      throw const ApiFailure('not_signed_in', 'Please sign in again.');
    }

    String? screenshotFileId;
    if (screenshotPath != null && screenshotPath.isNotEmpty) {
      try {
        final uploaded = await ref.read(mediaServiceProvider).processAndUpload(
              path: screenshotPath,
              userId: userId,
              bucketId: Buckets.feedbackMedia,
              prefix: 'feedback',
              maxEdge: 1080,
            );
        screenshotFileId = uploaded.fileId;
      } catch (_) {
        // Send the words without the picture.
      }
    }

    final context = await _gather();

    await ref.read(apiProvider).submitFeedback(
          category: category,
          message: message,
          screenshotFileId: screenshotFileId,
          refType: refType,
          refId: refId,
          appVersion: context.appVersion,
          platform: context.platform,
          deviceModel: context.model,
        );
  }
}

final feedbackControllerProvider =
    AsyncNotifierProvider<FeedbackController, void>(FeedbackController.new);
