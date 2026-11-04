import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

class LiveChartPoint {
  final int timeMs;
  final double value;

  const LiveChartPoint(this.timeMs, this.value);
}

class LiveChartSeries {
  final String id;
  final String label;
  final String unit;
  final Color color;
  final bool rightAxis;
  final List<LiveChartPoint> points;
  final double? latest;

  const LiveChartSeries({
    required this.id,
    required this.label,
    required this.unit,
    required this.color,
    required this.rightAxis,
    required this.points,
    this.latest,
  });
}

/// Time-axis viewport used by [LiveChart]. Extracted for unit tests.
class LiveChartViewport {
  static const int minSpanMs = 1000;
  static const int maxSpanMs = 10 * 60 * 1000;
  static const int followSlackMs = 750;

  final int startMs;
  final int endMs;
  final bool follow;

  const LiveChartViewport({
    required this.startMs,
    required this.endMs,
    required this.follow,
  });

  int get spanMs => math.max(1, endMs - startMs);

  LiveChartViewport copyWith({int? startMs, int? endMs, bool? follow}) {
    return LiveChartViewport(
      startMs: startMs ?? this.startMs,
      endMs: endMs ?? this.endMs,
      follow: follow ?? this.follow,
    );
  }

  static LiveChartViewport followWindow({
    required int nowMs,
    required int windowMs,
  }) {
    final span = windowMs.clamp(minSpanMs, maxSpanMs);
    return LiveChartViewport(
      startMs: nowMs - span,
      endMs: nowMs,
      follow: true,
    );
  }

  /// Earliest sample time across series, or null when empty.
  static int? earliestSampleMs(List<LiveChartSeries> series) {
    int? earliest;
    for (final item in series) {
      for (final point in item.points) {
        if (earliest == null || point.timeMs < earliest) {
          earliest = point.timeMs;
        }
      }
    }
    return earliest;
  }

  LiveChartViewport clampToBounds({
    required int nowMs,
    int? earliestMs,
  }) {
    final span = spanMs.clamp(minSpanMs, maxSpanMs);
    // While following, keep a fixed rolling window ending at "now". Do not
    // pin the left edge to the first sample — that shrinks/jitters the window
    // while the buffer is still filling.
    if (follow) {
      return LiveChartViewport(
        startMs: nowMs - span,
        endMs: nowMs,
        follow: true,
      );
    }

    final floor = earliestMs ?? (nowMs - maxSpanMs);
    var end = endMs;
    var start = startMs;

    if (end > nowMs) {
      end = nowMs;
      start = end - span;
    }
    if (start < floor) {
      start = floor;
      end = start + span;
      if (end > nowMs) {
        end = nowMs;
        final clipped = math.max(minSpanMs, end - start);
        start = end - clipped;
        if (start < floor) start = floor;
      }
    }

    // Re-engage follow when the viewport sits on the live edge again.
    final atLiveEdge = nowMs - end <= followSlackMs;
    return LiveChartViewport(
      startMs: start,
      endMs: end,
      follow: atLiveEdge,
    );
  }

  LiveChartViewport panByPixels({
    required double dx,
    required double plotWidth,
    required int nowMs,
    int? earliestMs,
  }) {
    if (plotWidth <= 0) return this;
    final deltaMs = (-dx / plotWidth * spanMs).round();
    return copyWith(
      startMs: startMs + deltaMs,
      endMs: endMs + deltaMs,
      follow: false,
    ).clampToBounds(nowMs: nowMs, earliestMs: earliestMs);
  }

  LiveChartViewport zoomAtFraction({
    required double scale,
    required double anchorFraction,
    required int nowMs,
    int? earliestMs,
  }) {
    final safeScale = scale.isFinite && scale > 0 ? scale : 1.0;
    final anchor = startMs + (spanMs * anchorFraction.clamp(0.0, 1.0)).round();
    final newSpan =
        (spanMs / safeScale).round().clamp(minSpanMs, maxSpanMs);
    final leftRatio = ((anchor - startMs) / spanMs).clamp(0.0, 1.0);
    final newStart = anchor - (newSpan * leftRatio).round();
    final newEnd = newStart + newSpan;
    return LiveChartViewport(
      startMs: newStart,
      endMs: newEnd,
      follow: false,
    ).clampToBounds(nowMs: nowMs, earliestMs: earliestMs);
  }
}

class LiveChart extends StatefulWidget {
  final List<LiveChartSeries> series;
  final int initialWindowSeconds;
  final bool compact;
  final ValueChanged<bool>? onFollowChanged;

  /// When this value changes, reset to follow mode with [initialWindowSeconds].
  final Object? followResetToken;

  const LiveChart({
    super.key,
    required this.series,
    int? initialWindowSeconds,
    @Deprecated('Use initialWindowSeconds') int? windowSeconds,
    this.compact = false,
    this.onFollowChanged,
    this.followResetToken,
  }) : initialWindowSeconds =
            initialWindowSeconds ?? windowSeconds ?? 60;

  @override
  State<LiveChart> createState() => _LiveChartState();
}

class _LiveChartState extends State<LiveChart>
    with SingleTickerProviderStateMixin {
  static const double _panBreakFollowPx = 14;

  Timer? _idleTick;
  late final Ticker _followTicker;
  late LiveChartViewport _viewport;
  double? _plotWidth;
  double? _pinchStartFocalX;
  LiveChartViewport? _pinchStartViewport;
  bool _panUnlocked = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now().millisecondsSinceEpoch;
    _viewport = LiveChartViewport.followWindow(
      nowMs: now,
      windowMs: widget.initialWindowSeconds * 1000,
    );
    _followTicker = createTicker((_) {
      if (!mounted || !_viewport.follow) return;
      _syncViewport(notifyFollow: false);
    })..start();
    // Keep a slow tick when frozen so clocks/labels still advance lightly.
    _idleTick = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (!mounted || _viewport.follow) return;
      _syncViewport(notifyFollow: false);
    });
  }

  @override
  void didUpdateWidget(covariant LiveChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.followResetToken != widget.followResetToken ||
        oldWidget.initialWindowSeconds != widget.initialWindowSeconds) {
      final now = DateTime.now().millisecondsSinceEpoch;
      _viewport = LiveChartViewport.followWindow(
        nowMs: now,
        windowMs: widget.initialWindowSeconds * 1000,
      );
      widget.onFollowChanged?.call(true);
    }
  }

  @override
  void dispose() {
    _followTicker.dispose();
    _idleTick?.cancel();
    super.dispose();
  }

  void _syncViewport({required bool notifyFollow}) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final earliest = _viewport.follow
        ? null
        : LiveChartViewport.earliestSampleMs(widget.series);
    final next = _viewport.clampToBounds(nowMs: now, earliestMs: earliest);
    final followChanged = next.follow != _viewport.follow;
    if (next.startMs == _viewport.startMs &&
        next.endMs == _viewport.endMs &&
        next.follow == _viewport.follow) {
      if (_viewport.follow) setState(() {}); // advance painter nowMs
      return;
    }
    setState(() => _viewport = next);
    if (notifyFollow || followChanged) {
      widget.onFollowChanged?.call(next.follow);
    }
  }

  void _setViewport(LiveChartViewport next, {bool notifyFollow = true}) {
    final prevFollow = _viewport.follow;
    setState(() => _viewport = next);
    if (notifyFollow && next.follow != prevFollow) {
      widget.onFollowChanged?.call(next.follow);
    }
  }

  void _resetFollow() {
    final now = DateTime.now().millisecondsSinceEpoch;
    _panUnlocked = false;
    _setViewport(
      LiveChartViewport.followWindow(
        nowMs: now,
        windowMs: widget.initialWindowSeconds * 1000,
      ),
    );
  }

  void _onScaleStart(ScaleStartDetails details) {
    _pinchStartFocalX = details.localFocalPoint.dx;
    _pinchStartViewport = _viewport;
    _panUnlocked = false;
  }

  void _onScaleUpdate(ScaleUpdateDetails details) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final earliest = LiveChartViewport.earliestSampleMs(widget.series);
    final plotWidth = _plotWidth;
    if (plotWidth == null || plotWidth <= 0) return;

    final start = _pinchStartViewport ?? _viewport;
    final leftPad = widget.compact ? 40.0 : 46.0;
    final focalInPlot =
        ((_pinchStartFocalX ?? details.localFocalPoint.dx) - leftPad)
            .clamp(0.0, plotWidth);
    final anchor = focalInPlot / plotWidth;

    if (details.pointerCount >= 2) {
      final next = start.zoomAtFraction(
        scale: details.scale,
        anchorFraction: anchor,
        nowMs: now,
        earliestMs: earliest,
      );
      // Pinch while following resizes the live window instead of freezing.
      if (start.follow) {
        _setViewport(
          LiveChartViewport.followWindow(nowMs: now, windowMs: next.spanMs),
          notifyFollow: true,
        );
      } else {
        _setViewport(next, notifyFollow: true);
      }
      return;
    }

    if (details.pointerCount == 1) {
      final dx = details.localFocalPoint.dx -
          (_pinchStartFocalX ?? details.localFocalPoint.dx);
      // Ignore tiny finger jitter so live follow is not accidentally paused.
      if (!_panUnlocked) {
        if (dx.abs() < _panBreakFollowPx) return;
        _panUnlocked = true;
      }
      final next = start.panByPixels(
        dx: dx,
        plotWidth: plotWidth,
        nowMs: now,
        earliestMs: earliest,
      );
      _setViewport(next, notifyFollow: true);
    }
  }

  void _onScaleEnd(ScaleEndDetails details) {
    _pinchStartFocalX = null;
    _pinchStartViewport = null;
    _panUnlocked = false;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final hasData = widget.series.any((s) => s.points.isNotEmpty);
    final now = DateTime.now().millisecondsSinceEpoch;
    final earliest = LiveChartViewport.earliestSampleMs(widget.series);
    final view = _viewport.clampToBounds(nowMs: now, earliestMs: earliest);

    return LayoutBuilder(
      builder: (context, constraints) {
        final hasRight = widget.series.any((s) => s.rightAxis && s.points.isNotEmpty);
        final leftPad = widget.compact ? 40.0 : 46.0;
        final rightPad = hasRight ? (widget.compact ? 40.0 : 46.0) : 12.0;
        _plotWidth = math.max(0, constraints.maxWidth - leftPad - rightPad);

        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onDoubleTap: _resetFollow,
          onScaleStart: _onScaleStart,
          onScaleUpdate: _onScaleUpdate,
          onScaleEnd: _onScaleEnd,
          child: CustomPaint(
            painter: _LiveChartPainter(
              series: widget.series,
              viewStartMs: view.startMs,
              viewEndMs: view.endMs,
              nowMs: now,
              follow: view.follow,
              compact: widget.compact,
              gridColor: cs.outline.withValues(alpha: 0.22),
              textColor: cs.onSurfaceVariant.withValues(alpha: 0.62),
              backgroundColor:
                  cs.surfaceContainerLowest.withValues(alpha: 0.35),
              followBadgeColor: cs.secondary,
            ),
            child: !hasData
                ? Center(
                    child: Text(
                      'Waiting for live frames…',
                      style: TextStyle(
                        fontSize: 12,
                        color: cs.onSurfaceVariant.withValues(alpha: 0.55),
                      ),
                    ),
                  )
                : const SizedBox.expand(),
          ),
        );
      },
    );
  }
}

class _LiveChartPainter extends CustomPainter {
  final List<LiveChartSeries> series;
  final int viewStartMs;
  final int viewEndMs;
  final int nowMs;
  final bool follow;
  final bool compact;
  final Color gridColor;
  final Color textColor;
  final Color backgroundColor;
  final Color followBadgeColor;

  _LiveChartPainter({
    required this.series,
    required this.viewStartMs,
    required this.viewEndMs,
    required this.nowMs,
    required this.follow,
    required this.compact,
    required this.gridColor,
    required this.textColor,
    required this.backgroundColor,
    required this.followBadgeColor,
  });

  int get _spanMs => math.max(1, viewEndMs - viewStartMs);

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 20 || size.height <= 20) return;

    final leftSeries = series.where((s) => !s.rightAxis).toList();
    final rightSeries = series.where((s) => s.rightAxis).toList();
    final hasRight = rightSeries.any((s) => s.points.isNotEmpty);

    final leftPad = compact ? 40.0 : 46.0;
    final rightPad = hasRight ? (compact ? 40.0 : 46.0) : 12.0;
    final topPad = compact ? 8.0 : 10.0;
    final bottomPad = compact ? 20.0 : 24.0;
    final plot = Rect.fromLTRB(
      leftPad,
      topPad,
      size.width - rightPad,
      size.height - bottomPad,
    );
    if (plot.width <= 0 || plot.height <= 0) return;

    final bg = Paint()..color = backgroundColor;
    canvas.drawRRect(
      RRect.fromRectAndRadius(plot, const Radius.circular(10)),
      bg,
    );

    final leftRange = _rangeFor(leftSeries);
    final rightRange = _rangeFor(rightSeries);

    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 0.7;
    const divisions = 4;
    for (var i = 0; i <= divisions; i++) {
      final y = plot.top + plot.height * i / divisions;
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), gridPaint);

      final leftValue =
          leftRange.max - (leftRange.max - leftRange.min) * i / divisions;
      _drawText(
        canvas,
        _formatValue(leftValue),
        Offset(plot.left - 6, y),
        alignRight: true,
      );

      if (hasRight) {
        final rightValue =
            rightRange.max - (rightRange.max - rightRange.min) * i / divisions;
        _drawText(
          canvas,
          _formatValue(rightValue),
          Offset(plot.right + 6, y),
          alignRight: false,
        );
      }
    }

    for (var i = 0; i <= 2; i++) {
      final x = plot.left + plot.width * i / 2;
      canvas.drawLine(Offset(x, plot.top), Offset(x, plot.bottom), gridPaint);
      final t = viewStartMs + (_spanMs * i / 2).round();
      final label = _formatTime(t);
      _drawText(
        canvas,
        label,
        Offset(x, plot.bottom + 6),
        alignCenter: i == 1,
        alignRight: i == 2,
      );
    }

    canvas.save();
    canvas.clipRect(plot);
    for (final item in series) {
      _drawSeries(
        canvas,
        plot,
        item,
        item.rightAxis ? rightRange : leftRange,
      );
    }
    canvas.restore();

    final border = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = gridColor;
    canvas.drawRRect(
      RRect.fromRectAndRadius(plot, const Radius.circular(10)),
      border,
    );

    if (follow) {
      _drawText(
        canvas,
        'LIVE',
        Offset(plot.right - 4, plot.top + 10),
        alignRight: true,
        color: followBadgeColor,
        bold: true,
      );
    }
  }

  void _drawSeries(
    Canvas canvas,
    Rect plot,
    LiveChartSeries item,
    _AxisRange range,
  ) {
    final path = Path();
    var started = false;
    Offset? lastPoint;
    final span = _spanMs.toDouble();
    for (final point in item.points) {
      if (point.timeMs < viewStartMs - 50) continue;
      if (point.timeMs > viewEndMs + 50) break;
      final x =
          plot.left + (point.timeMs - viewStartMs) / span * plot.width;
      final normalized =
          ((point.value - range.min) /
                  (range.max - range.min).clamp(0.000001, double.infinity))
              .toDouble();
      final y = plot.bottom - normalized * plot.height;
      if (!started) {
        path.moveTo(x, y);
        started = true;
      } else {
        path.lineTo(x, y);
      }
      lastPoint = Offset(x, y);
    }
    if (!started) return;

    final glow = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = compact ? 3 : 4
      ..strokeCap = StrokeCap.round
      ..color = item.color.withValues(alpha: 0.16);
    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = compact ? 1.4 : 1.6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = item.color;
    canvas.drawPath(path, glow);
    canvas.drawPath(path, line);

    if (lastPoint != null && pointInView(lastPoint, item)) {
      canvas.drawCircle(lastPoint, 4, Paint()..color = item.color);
      canvas.drawCircle(
        lastPoint,
        2,
        Paint()..color = Colors.white.withValues(alpha: 0.9),
      );
    }
  }

  bool pointInView(Offset lastPoint, LiveChartSeries item) {
    if (item.points.isEmpty) return false;
    final t = item.points.last.timeMs;
    return t >= viewStartMs && t <= viewEndMs + 50;
  }

  _AxisRange _rangeFor(List<LiveChartSeries> items) {
    var min = double.infinity;
    var max = double.negativeInfinity;
    var sawValue = false;
    var onlyBoolean = true;
    for (final item in items) {
      for (final point in item.points) {
        if (point.timeMs < viewStartMs || point.timeMs > viewEndMs) continue;
        sawValue = true;
        if (point.value < min) min = point.value;
        if (point.value > max) max = point.value;
        if (point.value != 0 && point.value != 1) onlyBoolean = false;
      }
    }
    if (!sawValue) return const _AxisRange(0, 1);
    if (onlyBoolean) return const _AxisRange(-0.1, 1.2);
    if ((max - min).abs() < 1e-9) {
      final pad = max.abs() < 1 ? 1.0 : max.abs() * 0.1;
      return _AxisRange(min - pad, max + pad);
    }
    final pad = (max - min) * 0.1;
    return _AxisRange(min - pad, max + pad);
  }

  void _drawText(
    Canvas canvas,
    String text,
    Offset anchor, {
    bool alignRight = false,
    bool alignCenter = false,
    Color? color,
    bool bold = false,
  }) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontSize: bold ? 9.5 : 9,
          fontFamily: 'monospace',
          fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
          color: color ?? textColor,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    var dx = anchor.dx;
    if (alignRight) dx -= painter.width;
    if (alignCenter) dx -= painter.width / 2;
    painter.paint(canvas, Offset(dx, anchor.dy - painter.height / 2));
  }

  String _formatValue(double value) {
    final abs = value.abs();
    if (abs >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
    if (abs >= 10000) return '${(value / 1000).toStringAsFixed(1)}k';
    if (abs >= 1000) return '${(value / 1000).toStringAsFixed(1)}k';
    if (abs >= 100) return value.toStringAsFixed(0);
    if (abs >= 10) return value.toStringAsFixed(1);
    if (abs >= 1) return value.toStringAsFixed(2);
    return value.toStringAsFixed(2);
  }

  String _formatTime(int timeMs) {
    final dt = DateTime.fromMillisecondsSinceEpoch(timeMs);
    String two(int v) => v.toString().padLeft(2, '0');
    final elapsed = math.max(0, nowMs - timeMs);
    if (follow && elapsed < 1000 && _spanMs <= 60000) return 'now';
    return '${two(dt.hour)}:${two(dt.minute)}:${two(dt.second)}';
  }

  @override
  bool shouldRepaint(covariant _LiveChartPainter oldDelegate) {
    return oldDelegate.nowMs != nowMs ||
        oldDelegate.series != series ||
        oldDelegate.viewStartMs != viewStartMs ||
        oldDelegate.viewEndMs != viewEndMs ||
        oldDelegate.follow != follow ||
        oldDelegate.compact != compact;
  }
}

class _AxisRange {
  final double min;
  final double max;

  const _AxisRange(this.min, this.max);
}
