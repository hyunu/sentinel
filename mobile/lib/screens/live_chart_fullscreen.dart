import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../widgets/live_chart.dart';

/// Immersive landscape analysis shell around [LiveChart].
class LiveChartFullscreen extends StatefulWidget {
  final String title;
  final String? subtitle;
  final List<LiveChartSeries> series;
  final int windowSeconds;
  final bool follow;
  final Object? followResetToken;
  final ValueChanged<int> onWindowSecondsChanged;
  final ValueChanged<bool>? onFollowChanged;
  final VoidCallback? onOpenFields;
  final VoidCallback onClose;
  final String fieldsLabel;

  const LiveChartFullscreen({
    super.key,
    required this.title,
    this.subtitle,
    required this.series,
    required this.windowSeconds,
    required this.follow,
    this.followResetToken,
    required this.onWindowSecondsChanged,
    this.onFollowChanged,
    this.onOpenFields,
    required this.onClose,
    this.fieldsLabel = 'Fields',
  });

  static Future<void> enterImmersive({bool lockLandscape = false}) async {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    if (lockLandscape) {
      await SystemChrome.setPreferredOrientations(const [
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
      ]);
    }
  }

  static Future<void> exitImmersive() async {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    await SystemChrome.setPreferredOrientations(const [
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
  }

  @override
  State<LiveChartFullscreen> createState() => _LiveChartFullscreenState();
}

class _LiveChartFullscreenState extends State<LiveChartFullscreen> {
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final pad = MediaQuery.paddingOf(context);

    return Material(
      color: cs.surface,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          math.max(pad.left, 8),
          math.max(pad.top, 4),
          math.max(pad.right, 8),
          math.max(pad.bottom, 4),
        ),
        child: Column(
          children: [
            SizedBox(
              height: 40,
              child: Row(
                children: [
                  IconButton(
                    onPressed: widget.onClose,
                    icon: const Icon(Icons.close_rounded, size: 20),
                    tooltip: 'Close',
                    visualDensity: VisualDensity.compact,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        Text(
                          [
                            if (widget.subtitle != null &&
                                widget.subtitle!.isNotEmpty)
                              widget.subtitle!,
                            widget.follow ? 'Following live' : 'Paused viewport',
                            'pinch zoom · drag pan · double-tap reset',
                          ].join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ),
                  ),
                  for (final seconds in const [30, 60, 120])
                    Padding(
                      padding: const EdgeInsets.only(left: 4),
                      child: ChoiceChip(
                        label: Text(
                          seconds < 60 ? '${seconds}s' : '${seconds ~/ 60}m',
                          style: const TextStyle(fontSize: 10),
                        ),
                        selected: widget.windowSeconds == seconds,
                        onSelected: (_) =>
                            widget.onWindowSecondsChanged(seconds),
                        visualDensity: VisualDensity.compact,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                      ),
                    ),
                  if (widget.onOpenFields != null)
                    TextButton.icon(
                      onPressed: widget.onOpenFields,
                      icon: const Icon(Icons.tune_rounded, size: 15),
                      label: Text(
                        widget.fieldsLabel,
                        style: const TextStyle(fontSize: 11),
                      ),
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                      ),
                    ),
                  if (!widget.follow)
                    TextButton(
                      onPressed: () =>
                          widget.onWindowSecondsChanged(widget.windowSeconds),
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                      ),
                      child: const Text('Follow', style: TextStyle(fontSize: 11)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            Expanded(
              child: LiveChart(
                series: widget.series,
                initialWindowSeconds: widget.windowSeconds,
                followResetToken: widget.followResetToken,
                onFollowChanged: widget.onFollowChanged,
                compact: true,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
