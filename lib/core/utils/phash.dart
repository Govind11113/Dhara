import 'dart:math' as math;
import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// DCT-based perceptual hash.
///
/// This is the cheapest defence against the most common cheat: submitting the
/// same photo (or one pulled off the internet) for a different tree or month.
/// A pHash survives resizing, re-compression and small brightness shifts, so
/// near-duplicates still collide.
///
/// Output is 64 bits rendered as 16 hex chars.
class PHash {
  const PHash._();

  static const _size = 32;
  static const _lowFreq = 8;

  /// Runs on a background isolate via [computeFor] — DCT on 32x32 is fast but
  /// decoding a 12 MP JPEG is not.
  static String ofBytes(Uint8List bytes) {
    final decoded = img.decodeImage(bytes);
    if (decoded == null) {
      throw const FormatException('Unsupported or corrupt image');
    }

    final small = img.copyResize(
      img.grayscale(decoded),
      width: _size,
      height: _size,
      interpolation: img.Interpolation.average,
    );

    final pixels = List<List<double>>.generate(
      _size,
      (y) => List<double>.generate(
        _size,
        (x) => small.getPixel(x, y).r.toDouble(),
        growable: false,
      ),
      growable: false,
    );

    final dct = _dct2d(pixels);

    // Skip the DC term: it only encodes average brightness.
    final coeffs = <double>[];
    for (var y = 0; y < _lowFreq; y++) {
      for (var x = 0; x < _lowFreq; x++) {
        if (x == 0 && y == 0) continue;
        coeffs.add(dct[y][x]);
      }
    }

    final median = _median(coeffs);

    var bits = 0;
    final buffer = StringBuffer();
    var count = 0;
    for (final c in coeffs.take(64)) {
      bits = (bits << 1) | (c > median ? 1 : 0);
      count++;
      if (count % 4 == 0) {
        buffer.write((bits & 0xF).toRadixString(16));
      }
    }
    // 63 coefficients -> pad the final nibble so the hash is a stable width.
    if (count % 4 != 0) {
      bits <<= 4 - (count % 4);
      buffer.write((bits & 0xF).toRadixString(16));
    }
    return buffer.toString();
  }

  static List<List<double>> _dct2d(List<List<double>> input) {
    final n = input.length;
    final cos = List<List<double>>.generate(
      n,
      (u) => List<double>.generate(
        n,
        (x) => math.cos((2 * x + 1) * u * math.pi / (2 * n)),
        growable: false,
      ),
      growable: false,
    );

    // Rows first, then columns: O(n^3) instead of the naive O(n^4).
    final rows = List<List<double>>.generate(
      n,
      (y) => List<double>.filled(n, 0),
      growable: false,
    );
    for (var y = 0; y < n; y++) {
      for (var u = 0; u < n; u++) {
        var sum = 0.0;
        for (var x = 0; x < n; x++) {
          sum += input[y][x] * cos[u][x];
        }
        rows[y][u] = sum * (u == 0 ? math.sqrt1_2 : 1.0);
      }
    }

    final out = List<List<double>>.generate(
      n,
      (y) => List<double>.filled(n, 0),
      growable: false,
    );
    for (var u = 0; u < n; u++) {
      for (var v = 0; v < n; v++) {
        var sum = 0.0;
        for (var y = 0; y < n; y++) {
          sum += rows[y][u] * cos[v][y];
        }
        out[v][u] = sum * (v == 0 ? math.sqrt1_2 : 1.0);
      }
    }
    return out;
  }

  static double _median(List<double> values) {
    final sorted = [...values]..sort();
    final mid = sorted.length ~/ 2;
    if (sorted.length.isOdd) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /// Number of differing bits. 0 means identical, >10 means unrelated images.
  static int hamming(String a, String b) {
    if (a.length != b.length) return 64;
    var distance = 0;
    for (var i = 0; i < a.length; i++) {
      final xor = int.parse(a[i], radix: 16) ^ int.parse(b[i], radix: 16);
      distance += _bitCount(xor);
    }
    return distance;
  }

  static int _bitCount(int v) {
    var n = v, c = 0;
    while (n != 0) {
      c += n & 1;
      n >>= 1;
    }
    return c;
  }

  /// Short prefix used as a coarse bucket key so we can shortlist candidates
  /// server-side before doing exact Hamming comparisons.
  static String prefix(String hash) =>
      hash.length >= 4 ? hash.substring(0, 4) : hash;
}
