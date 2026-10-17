import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/services/location.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/haptics.dart';
import '../../data/models/tree.dart';

/// OpenStreetMap raster tiles.
///
/// Chosen over Google Maps because that needs an API key with billing enabled
/// before it renders anything at all — without one the user gets a blank grey
/// rectangle. These tiles work with no credentials. OSM's usage policy requires
/// an identifying User-Agent, which [TileLayer.userAgentPackageName] supplies.
const _tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const _userAgent = 'com.dhara.greencredits';

/// A live map of where the user is standing, with their existing trees on it.
///
/// This exists for a concrete reason beyond orientation: the server rejects any
/// tree planted within [spacingRingM] of another one, and that rejection
/// currently arrives only *after* the user has framed and taken a photo. Drawing
/// the exclusion rings makes the rule visible while they can still take a step
/// sideways.
class TreeMap extends StatefulWidget {
  const TreeMap({
    super.key,
    required this.me,
    this.trees = const [],
    this.spacingRingM,
    this.height = 280,
    this.showAccuracyCircle = true,
    this.onTreeTap,
    this.error,
    this.onRetry,
    this.approximate = false,
    this.patience = const Duration(seconds: 15),
  });

  /// Live position. Null while the first fix is still settling.
  final LocationFix? me;

  /// Trees to draw. Only ones near [me] are worth passing; the widget does not
  /// filter, so the caller controls the cost.
  final List<Tree> trees;

  /// Radius of the "too close to plant" ring around each existing tree.
  final double? spacingRingM;

  final double height;

  /// The GPS uncertainty circle. Worth showing: it is the difference between
  /// "you are here" and "you are somewhere in here", and the second is the
  /// truth.
  final bool showAccuracyCircle;

  final void Function(Tree tree)? onTreeTap;

  /// Why there is no position, if the caller knows. Shown in place of the
  /// spinner: a map that says "Finding you" while the screen under it already
  /// knows the location is off is the loop users reported.
  final String? error;

  /// Offered on the failed and the taking-too-long states.
  final VoidCallback? onRetry;

  /// True while [me] is only a cached position. Drawn with a note so nobody
  /// reads a minutes-old dot as where they are standing.
  final bool approximate;

  /// How long to wait for a first position before admitting it is slow.
  final Duration patience;

  @override
  State<TreeMap> createState() => _TreeMapState();
}

class _TreeMapState extends State<TreeMap> {
  final _controller = MapController();

  /// The camera only chases the user while they have not taken over. Yanking the
  /// view back under someone who deliberately panned away is hostile.
  bool _follow = true;

  /// `move` throws if called before the map is laid out.
  bool _ready = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(TreeMap old) {
    super.didUpdateWidget(old);

    final me = widget.me;
    if (me == null || !_follow || !_ready) return;

    final moved = old.me == null ||
        old.me!.lat != me.lat ||
        old.me!.lng != me.lng;
    if (moved) {
      _controller.move(LatLng(me.lat, me.lng), _controller.camera.zoom);
    }
  }

  void _recenter() {
    final me = widget.me;
    if (me == null || !_ready) return;
    Haptics.tap();
    setState(() => _follow = true);
    _controller.move(LatLng(me.lat, me.lng), 18);
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: SizedBox(
        height: widget.height,
        // Centring the map on (0, 0) while waiting for a fix would drop the user
        // in the Atlantic and make the first frame look broken.
        child: me == null
            ? _MapPlaceholder(
                error: widget.error,
                onRetry: widget.onRetry,
                patience: widget.patience,
              )
            : Stack(
                children: [
                  FlutterMap(
                    mapController: _controller,
                    options: MapOptions(
                      initialCenter: LatLng(me.lat, me.lng),
                      initialZoom: 18,
                      minZoom: 3,
                      // 19 is as deep as OSM raster tiles go; past that the
                      // layer just serves blanks.
                      maxZoom: 19,
                      backgroundColor: AppColors.surfaceMuted,
                      onMapReady: () {
                        if (mounted) setState(() => _ready = true);
                      },
                      onPositionChanged: (_, hasGesture) {
                        if (hasGesture && _follow) {
                          setState(() => _follow = false);
                        }
                      },
                      interactionOptions: const InteractionOptions(
                        // Rotation off: a rotated map makes "the tree is north
                        // of you" unreadable, and nothing here needs it.
                        flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
                      ),
                    ),
                    children: [
                      TileLayer(
                        urlTemplate: _tileUrl,
                        userAgentPackageName: _userAgent,
                      ),
                      CircleLayer(circles: _circles(me)),
                      MarkerLayer(markers: _markers(me)),
                    ],
                  ),

                  _Attribution(),

                  if (widget.approximate) const _ApproximateNote(),

                  if (!_follow)
                    Positioned(
                      right: 10,
                      bottom: 10,
                      child: _RecenterButton(onTap: _recenter),
                    ),
                ],
              ),
      ),
    );
  }

  List<CircleMarker> _circles(LocationFix me) {
    final circles = <CircleMarker>[];

    // Exclusion rings first, so the user's own dot draws over them.
    final ring = widget.spacingRingM;
    if (ring != null) {
      for (final tree in widget.trees) {
        circles.add(
          CircleMarker(
            point: LatLng(tree.lat, tree.lng),
            radius: ring,
            useRadiusInMeter: true,
            color: AppColors.danger.withValues(alpha: 0.10),
            borderColor: AppColors.danger.withValues(alpha: 0.35),
            borderStrokeWidth: 1,
          ),
        );
      }
    }

    if (widget.showAccuracyCircle && me.accuracyM > 0) {
      circles.add(
        CircleMarker(
          point: LatLng(me.lat, me.lng),
          radius: me.accuracyM,
          useRadiusInMeter: true,
          color: AppColors.info.withValues(alpha: 0.12),
          borderColor: AppColors.info.withValues(alpha: 0.40),
          borderStrokeWidth: 1,
        ),
      );
    }

    return circles;
  }

  List<Marker> _markers(LocationFix me) {
    return [
      for (final tree in widget.trees)
        Marker(
          point: LatLng(tree.lat, tree.lng),
          width: 38,
          height: 38,
          child: _TreeMarker(
            tree: tree,
            onTap: widget.onTreeTap == null
                ? null
                : () => widget.onTreeTap!(tree),
          ),
        ),
      Marker(
        point: LatLng(me.lat, me.lng),
        width: 26,
        height: 26,
        child: const _MeDot(),
      ),
    ];
  }
}

/// What the map shows until it has somewhere to point.
///
/// Three honest states instead of one spinner that never ends: looking, looking
/// for suspiciously long, and failed. The last two offer a retry, because
/// "wait and see" is not advice when the cause is a switched-off GPS.
class _MapPlaceholder extends StatefulWidget {
  const _MapPlaceholder({
    required this.error,
    required this.onRetry,
    required this.patience,
  });

  final String? error;
  final VoidCallback? onRetry;
  final Duration patience;

  @override
  State<_MapPlaceholder> createState() => _MapPlaceholderState();
}

class _MapPlaceholderState extends State<_MapPlaceholder> {
  Timer? _timer;
  bool _slow = false;

  @override
  void initState() {
    super.initState();
    _arm();
  }

  void _arm() {
    _timer?.cancel();
    _slow = false;
    _timer = Timer(widget.patience, () {
      if (mounted) setState(() => _slow = true);
    });
  }

  @override
  void didUpdateWidget(_MapPlaceholder old) {
    super.didUpdateWidget(old);
    // A retry clears the error. Without restarting the clock the map would jump
    // straight back to "still looking" on a search that has only just begun.
    if (old.error != null && widget.error == null) _arm();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final failed = widget.error != null;
    final stuck = failed || _slow;

    final message = failed
        ? widget.error!
        : _slow
            ? 'Still looking for you. Step into the open and hold still \u2014 '
                'this can take a minute indoors.'
            : 'Finding you on the map\u2026';

    return Semantics(
      liveRegion: true,
      child: ColoredBox(
        color: AppColors.surfaceMuted,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (failed)
                  const Icon(
                    Icons.location_off_rounded,
                    size: 26,
                    color: AppColors.danger,
                  )
                else
                  const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.2,
                      color: AppColors.green,
                    ),
                  ),
                const SizedBox(height: 12),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12.5,
                    height: 1.4,
                    fontWeight: FontWeight.w700,
                    color: AppColors.inkSoft,
                  ),
                ),
                if (stuck && widget.onRetry != null) ...[
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: () {
                      Haptics.tap();
                      widget.onRetry!();
                    },
                    child: const Text('Try again'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ApproximateNote extends StatelessWidget {
  const _ApproximateNote();

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 10,
      top: 10,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(999),
        ),
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          child: Text(
            'Approximate \u00B7 getting a precise fix\u2026',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: AppColors.inkSoft,
            ),
          ),
        ),
      ),
    );
  }
}

/// The user's own position.
class _MeDot extends StatelessWidget {
  const _MeDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.info,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
    );
  }
}

class _TreeMarker extends StatelessWidget {
  const _TreeMarker({required this.tree, this.onTap});

  final Tree tree;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final alive = tree.status.countsAsLiving;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: alive ? AppColors.green : AppColors.amber,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2.5),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.22),
              blurRadius: 5,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: const Center(
          child: Text('\u{1F333}', style: TextStyle(fontSize: 16)),
        ),
      ),
    );
  }
}

/// OSM's licence requires visible attribution.
class _Attribution extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 6,
      bottom: 4,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.75),
          borderRadius: BorderRadius.circular(4),
        ),
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 5, vertical: 1),
          child: Text(
            '\u00A9 OpenStreetMap',
            style: TextStyle(
              fontSize: 8.5,
              fontWeight: FontWeight.w600,
              color: AppColors.inkSoft,
            ),
          ),
        ),
      ),
    );
  }
}

class _RecenterButton extends StatelessWidget {
  const _RecenterButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: const CircleBorder(),
      elevation: 3,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: const Padding(
          padding: EdgeInsets.all(9),
          child: Icon(
            Icons.my_location_rounded,
            size: 20,
            color: AppColors.green,
          ),
        ),
      ),
    );
  }
}
