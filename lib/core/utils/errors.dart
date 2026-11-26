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
    // The server does not have this endpoint: an app newer than the deployed
    // server. Say what that means for the user instead of "Unknown route".
    ApiFailure() when isUnknownRoute(error) =>
      'Dhara\u2019s server has not been updated for this feature yet, so it '
          'cannot be saved or loaded right now. Nothing you entered was lost.',
    ApiFailure(:final message) => message,
    LocationFailure(:final message) => message,
    // Raised by photo processing when a capture cannot be decoded.
    FormatException(:final message) =>
      message.isEmpty ? 'That photo could not be read.' : message,
    _ => friendlyError(error),
  };
}

/// True when the server answered that it has no such endpoint. Servers built
/// from this branch say `unknown_route`; older ones say `not_found` with an
/// "Unknown route" message, which is told apart from an ordinary missing record
/// by that wording.
bool isUnknownRoute(ApiFailure e) =>
    e.code == 'unknown_route' ||
    (e.code == 'not_found' && e.message.startsWith('Unknown route'));
