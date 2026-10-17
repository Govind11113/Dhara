import '../../data/models/tree.dart';

/// What trees absorb, worked out from the species table.
///
/// These are typical figures for a *mature* tree of each species, as stored in
/// the `species` collection. They are estimates, not measurements: real uptake
/// depends on age, climate, soil and care, and a sapling absorbs far less than
/// a grown tree in its first years. The UI says so wherever it shows them.
class TreeCo2 {
  const TreeCo2({
    required this.avgKgPerYear,
    required this.myKgPerYear,
    required this.myLivingTrees,
  });

  /// The mean over the real species, i.e. what "an average tree" absorbs.
  final double avgKgPerYear;

  /// The same figure added up over the user's own living trees.
  final double myKgPerYear;

  final int myLivingTrees;

  double get avgGramsPerDay => avgKgPerYear * 1000 / 365;
}

/// The catch-all entry is a placeholder for "I don't know what this is", so it
/// says nothing about what a typical tree does and is left out of the average.
const _placeholderSpecies = 'other';

/// Null when there is nothing to average (an empty or unloaded species table).
TreeCo2? computeTreeCo2(List<Species> species, List<Tree> trees) {
  final real = species
      .where((s) => s.code != _placeholderSpecies && s.co2PerYearGrams > 0)
      .toList();
  if (real.isEmpty) return null;

  final avgGrams =
      real.fold<int>(0, (sum, s) => sum + s.co2PerYearGrams) / real.length;

  final byCode = {
    for (final s in species)
      if (s.co2PerYearGrams > 0) s.code: s.co2PerYearGrams,
  };

  var myGrams = 0.0;
  var living = 0;
  for (final tree in trees) {
    // A tree still in review, or one that has died, is not absorbing anything
    // the member can claim.
    if (!tree.status.countsAsLiving) continue;
    living++;
    // A species the table does not know falls back to the average rather than
    // to zero, which would quietly undercount.
    myGrams += byCode[tree.speciesCode] ?? avgGrams;
  }

  return TreeCo2(
    avgKgPerYear: avgGrams / 1000,
    myKgPerYear: myGrams / 1000,
    myLivingTrees: living,
  );
}

/// "21 kg", "4.5 kg", "0.8 kg". Whole kilograms once it is past ten, because a
/// decimal on an estimate that rough suggests precision it does not have.
String formatKg(double kg) {
  if (kg <= 0) return '0 kg';
  if (kg >= 10) return '${kg.round()} kg';
  final text = kg.toStringAsFixed(1);
  return '${text.endsWith('.0') ? text.substring(0, text.length - 2) : text} kg';
}

/// Kilograms below a tonne, tonnes above: "820 kg", "1.9 t", "12 t".
///
/// Used for yearly footprints, where "1881 kg" is harder to read than "1.9 t".
String formatCo2(double kg) {
  if (kg <= 0) return '0 kg';
  if (kg < 1000) return formatKg(kg);
  final t = kg / 1000;
  final text = t >= 10 ? t.round().toString() : t.toStringAsFixed(1);
  return '${text.endsWith('.0') ? text.substring(0, text.length - 2) : text} t';
}
