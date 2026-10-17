import 'package:equatable/equatable.dart';

/// What a piece of feedback is about.
///
/// `wire` values must match the `category` enum in scripts/schema.mjs — the
/// server validates against its own copy of this list and rejects anything
/// else, so a mismatch here surfaces as `invalid_category`.
enum FeedbackCategory {
  bug('bug', 'Something is broken', '\u{1F41B}'),
  idea('idea', 'I have an idea', '\u{1F4A1}'),
  rewardRequest('reward_request', 'Suggest a reward', '\u{1F381}'),
  verificationDispute(
    'verification_dispute',
    'A photo was wrongly rejected',
    '\u{1F333}',
  ),
  other('other', 'Something else', '\u{1F4AC}');

  const FeedbackCategory(this.wire, this.label, this.emoji);

  final String wire;
  final String label;
  final String emoji;

  static FeedbackCategory parse(Object? v) => FeedbackCategory.values.firstWhere(
        (c) => c.wire == v,
        orElse: () => FeedbackCategory.other,
      );
}

enum FeedbackStatus {
  open('open', 'Open'),
  triaged('triaged', 'Being looked at'),
  answered('answered', 'Answered'),
  closed('closed', 'Closed');

  const FeedbackStatus(this.wire, this.label);

  final String wire;
  final String label;

  static FeedbackStatus parse(Object? v) => FeedbackStatus.values.firstWhere(
        (s) => s.wire == v,
        orElse: () => FeedbackStatus.open,
      );
}

class FeedbackEntry extends Equatable {
  const FeedbackEntry({
    required this.id,
    required this.category,
    required this.message,
    required this.status,
    required this.createdAt,
    this.screenshotFileId,
    this.adminReply,
  });

  final String id;
  final FeedbackCategory category;
  final String message;
  final FeedbackStatus status;
  final DateTime createdAt;
  final String? screenshotFileId;
  final String? adminReply;

  bool get hasReply => (adminReply ?? '').trim().isNotEmpty;

  factory FeedbackEntry.fromMap(Map<String, dynamic> m) => FeedbackEntry(
        id: (m[r'$id'] ?? '') as String,
        category: FeedbackCategory.parse(m['category']),
        message: (m['message'] ?? '') as String,
        status: FeedbackStatus.parse(m['status']),
        createdAt: DateTime.tryParse((m['createdAt'] ?? '') as String) ??
            DateTime.now(),
        screenshotFileId: m['screenshotFileId'] as String?,
        adminReply: m['adminReply'] as String?,
      );

  @override
  List<Object?> get props => [id, status, adminReply];
}
