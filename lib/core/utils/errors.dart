import '../services/api.dart';
import '../services/appwrite.dart';
import '../services/location.dart';

/// The single "what do I show the user?" entry point for the UI.
///
/// [friendlyError] only understands Appwrite's own exceptions. The app's own
/// failures already carry a message written for a human — the server explains
/// exactly why a check-in was rejected, for instance — and passing those
/// through [friendlyError] would throw that away and show a generic apology
/// instead. So the app's own types are unwrapped first.
String friendlyMessage(Object? error) {
  if (error == null) return 'Something went wrong. Please try again.';

  return switch (error) {
    ApiFailure(:final message) => message,
    LocationFailure(:final message) => message,
    // Raised by photo processing when a capture cannot be decoded.
    FormatException(:final message) =>
      message.isEmpty ? 'That photo could not be read.' : message,
    _ => friendlyError(error),
  };
}
