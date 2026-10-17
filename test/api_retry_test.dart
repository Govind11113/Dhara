import 'package:appwrite/appwrite.dart';
import 'package:appwrite/models.dart' as models;
import 'package:dhara/core/services/api.dart';
import 'package:dhara/core/services/appwrite.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _Account extends Fake implements Account {
  @override
  dynamic noSuchMethod(Invocation i) {
    if (i.memberName == #createJWT) return Future.value(models.Jwt(jwt: 'token'));
    return super.noSuchMethod(i);
  }
}

/// Answers each execution with the next body in [replies]; the last repeats.
class _Functions extends Fake implements Functions {
  _Functions(this.replies);

  final List<String> replies;
  int calls = 0;

  @override
  dynamic noSuchMethod(Invocation i) {
    if (i.memberName != #createExecution) return super.noSuchMethod(i);
    final body = replies[calls < replies.length ? calls : replies.length - 1];
    calls++;
    return Future.value(models.Execution.fromMap({
      r'$id': 'e$calls', r'$createdAt': '2026-10-18T00:00:00.000Z', r'$updatedAt': '2026-10-18T00:00:00.000Z',
      r'$permissions': <String>[], 'resourceId': 'api', 'resourceType': 'functions',
      'deploymentId': 'd', 'trigger': 'http', 'status': body.isEmpty ? 'failed' : 'completed',
      'requestMethod': 'POST', 'requestPath': '/x', 'requestHeaders': <Map<String, dynamic>>[],
      'responseStatusCode': body.isEmpty ? 500 : 200, 'responseBody': body,
      'responseHeaders': <Map<String, dynamic>>[], 'logs': '', 'errors': body.isEmpty ? 'general_unknown' : '',
      'duration': 0.1,
    }));
  }
}

const ok = '{"ok":true,"data":{"v":1}}';
const refused = '{"ok":false,"error":{"code":"nothing_entered","message":"Enter something."}}';

({Api api, _Functions fn}) build(List<String> replies) {
  final fn = _Functions(replies);
  final container = ProviderContainer(overrides: [
    accountProvider.overrideWithValue(_Account()),
    functionsProvider.overrideWithValue(fn),
  ]);
  addTearDown(container.dispose);
  return (api: container.read(apiProvider), fn: fn);
}

void main() {
  const quick = Duration(milliseconds: 1);

  test('post: an empty reply is reported as a function error', () async {
    final t = build(['']);
    await expectLater(t.api.post('/x'), throwsA(isA<ApiFailure>().having((e) => e.code, 'code', 'function_error')));
  });

  group('postIdempotent', () {
    test('a good first answer is used and nothing is repeated', () async {
      final t = build([ok]);
      expect(await t.api.postIdempotent('/x', const {}, quick), {'v': 1});
      expect(t.fn.calls, 1);
    });

    // The reported cold-start blip: an empty reply, then it works.
    test('an empty first reply is retried once and the second answer is used', () async {
      final t = build(['', ok]);
      expect(await t.api.postIdempotent('/x', const {}, quick), {'v': 1});
      expect(t.fn.calls, 2);
    });

    test('it gives up after one retry rather than looping', () async {
      final t = build(['']);
      await expectLater(t.api.postIdempotent('/x', const {}, quick), throwsA(isA<ApiFailure>()));
      expect(t.fn.calls, 2);
    });

    // A refusal is an answer, not a blip. Repeating it would only repeat it.
    test('a business rejection is not retried', () async {
      final t = build([refused, ok]);
      await expectLater(
        t.api.postIdempotent('/x', const {}, quick),
        throwsA(isA<ApiFailure>().having((e) => e.code, 'code', 'nothing_entered')),
      );
      expect(t.fn.calls, 1);
    });

    test('plain post never retries (it is what money-moving calls use)', () async {
      final t = build(['', ok]);
      await expectLater(t.api.post('/x'), throwsA(isA<ApiFailure>()));
      expect(t.fn.calls, 1);
    });
  });
}
