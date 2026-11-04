import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

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

class LiveChart extends StatefulWidget {
  final List<LiveChartSeries> series;
  final int windowSeconds;

  const LiveChart({super.key, required this.series, this.windowSeconds = 60});

  @override
  State<LiveChart> createState() => _LiveChartState();
}

class _LiveChartState extends State<LiveChart> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    // Keep the time axis moving even when no new frame arrives.
    _tick = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final hasData = widget.series.any((s) => s.points.isNotEmpty);
    return CustomPaint(
      painter: _LiveChartPainter(
        series: widget.series,
        windowMs: widget.windowSeconds * 1000,
        nowMs: DateTime.now().millisecondsSinceEpoch,
        gridColor: cs.outline.withValues(alpha: 0.22),
        textColor: cs.onSurfaceVariant.withValues(alpha: 0.62),
        backgroundColor: cs.surfaceContainerLowest.withValues(alpha: 0.35),
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
    );
  }
}

class _LiveChartPainter extends CustomPainter {
  final List<LiveChartSeries> series;
  final int windowMs;
  final int nowMs;
  final Color gridColor;
  final Color textColor;
  final Color backgroundColor;

  _LiveChartPainter({
    required this.series,
    required this.windowMs,
    required this.nowMs,
    required this.gridColor,
    required this.textColor,
    required this.backgroundColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 20 || size.height <= 20) return;
    final windowStart = nowMs - windowMs;

    final leftSeries = series.where((s) => !s.rightAxis).toList();
    final rightSeries = series.where((s) => s.rightAxis).toList();
    final hasRight = rightSeries.any((s) => s.points.isNotEmpty);

    const leftPad = 46.0;
    final rightPad = hasRight ? 46.0 : 12.0;
    const topPad = 10.0;
    const bottomPad = 24.0;
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

    final leftRange = _rangeFor(leftSeries, windowStart);
    final rightRange = _rangeFor(rightSeries, windowStart);

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
      final t = windowStart + (windowMs * i / 2).round();
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
        windowStart,
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
  }

  void _drawSeries(
    Canvas canvas,
    Rect plot,
    LiveChartSeries item,
    int windowStart,
    _AxisRange range,
  ) {
    final path = Path();
    var started = false;
    Offset? lastPoint;
    for (final point in item.points) {
      if (point.timeMs < windowStart) continue;
      final x =
          plot.left + (point.timeMs - windowStart) / windowMs * plot.width;
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
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round
      ..color = item.color.withValues(alpha: 0.16);
    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = item.color;
    canvas.drawPath(path, glow);
    canvas.drawPath(path, line);

    if (lastPoint != null) {
      canvas.drawCircle(lastPoint, 4, Paint()..color = item.color);
      canvas.drawCircle(
        lastPoint,
        2,
        Paint()..color = Colors.white.withValues(alpha: 0.9),
      );
    }
  }

  _AxisRange _rangeFor(List<LiveChartSeries> items, int windowStart) {
    var min = double.infinity;
    var max = double.negativeInfinity;
    var sawValue = false;
    var onlyBoolean = true;
    for (final item in items) {
      for (final point in item.points) {
        if (point.timeMs < windowStart) continue;
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
  }) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontSize: 9,
          fontFamily: 'monospace',
          color: textColor,
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
    if (elapsed < 1000 && windowMs <= 60000) return 'now';
    return '${two(dt.hour)}:${two(dt.minute)}:${two(dt.second)}';
  }

  @override
  bool shouldRepaint(covariant _LiveChartPainter oldDelegate) {
    return oldDelegate.nowMs != nowMs ||
        oldDelegate.series != series ||
        oldDelegate.windowMs != windowMs;
  }
}

class _AxisRange {
  final double min;
  final double max;

  const _AxisRange(this.min, this.max);
}
