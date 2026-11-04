import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sentinel_mobile/widgets/live_chart.dart';

void main() {
  group('LiveChartViewport', () {
    test('followWindow creates a live-aligned span', () {
      final view = LiveChartViewport.followWindow(
        nowMs: 10_000,
        windowMs: 60_000,
      );
      expect(view.follow, isTrue);
      expect(view.endMs, 10_000);
      expect(view.spanMs, 60_000);
      expect(view.startMs, -50_000);
    });

    test('clamp keeps viewport inside sample bounds and now', () {
      final view = const LiveChartViewport(
        startMs: 0,
        endMs: 5_000,
        follow: false,
      );
      final clamped = view.clampToBounds(nowMs: 4_000, earliestMs: 1_000);
      expect(clamped.endMs, lessThanOrEqualTo(4_000));
      expect(clamped.startMs, greaterThanOrEqualTo(1_000));
      expect(clamped.spanMs, greaterThanOrEqualTo(LiveChartViewport.minSpanMs));
    });

    test('pan moves window and exits follow', () {
      final view = LiveChartViewport.followWindow(
        nowMs: 20_000,
        windowMs: 10_000,
      );
      final panned = view.panByPixels(
        dx: 100,
        plotWidth: 200,
        nowMs: 20_000,
        earliestMs: 0,
      );
      expect(panned.follow, isFalse);
      expect(panned.startMs, lessThan(view.startMs));
      expect(panned.spanMs, view.spanMs);
    });

    test('zoomAtFraction shrinks span around anchor', () {
      const view = LiveChartViewport(
        startMs: 0,
        endMs: 10_000,
        follow: true,
      );
      final zoomed = view.zoomAtFraction(
        scale: 2,
        anchorFraction: 0.5,
        nowMs: 10_000,
        earliestMs: 0,
      );
      expect(zoomed.spanMs, 5_000);
      expect(zoomed.follow, isFalse);
      expect(zoomed.startMs, 2_500);
      expect(zoomed.endMs, 7_500);
    });

    test('zoom respects min and max span', () {
      const view = LiveChartViewport(
        startMs: 0,
        endMs: 2_000,
        follow: false,
      );
      final tooTight = view.zoomAtFraction(
        scale: 100,
        anchorFraction: 0.5,
        nowMs: 2_000,
        earliestMs: 0,
      );
      expect(tooTight.spanMs, LiveChartViewport.minSpanMs);

      final wide = LiveChartViewport.followWindow(
        nowMs: 60_000,
        windowMs: LiveChartViewport.maxSpanMs,
      ).zoomAtFraction(
        scale: 0.1,
        anchorFraction: 1,
        nowMs: 60_000,
        earliestMs: 0,
      );
      expect(wide.spanMs, lessThanOrEqualTo(LiveChartViewport.maxSpanMs));
    });

    test('earliestSampleMs finds the oldest point', () {
      final earliest = LiveChartViewport.earliestSampleMs([
        const LiveChartSeries(
          id: 'a',
          label: 'A',
          unit: '',
          color: Colors.red,
          rightAxis: false,
          points: [
            LiveChartPoint(500, 1),
            LiveChartPoint(900, 2),
          ],
        ),
        const LiveChartSeries(
          id: 'b',
          label: 'B',
          unit: '',
          color: Colors.blue,
          rightAxis: true,
          points: [LiveChartPoint(100, 3)],
        ),
      ]);
      expect(earliest, 100);
      expect(LiveChartViewport.earliestSampleMs(const []), isNull);
    });

    test('follow keeps a fixed rolling window ending at now', () {
      final following = const LiveChartViewport(
        startMs: 0,
        endMs: 5_000,
        follow: true,
      ).clampToBounds(nowMs: 10_000, earliestMs: 8_000);
      expect(following.follow, isTrue);
      expect(following.endMs, 10_000);
      expect(following.startMs, 5_000);
      expect(following.spanMs, 5_000);
    });

    test('follow re-engages when viewport reaches the live edge', () {
      final frozen = const LiveChartViewport(
        startMs: 0,
        endMs: 8_000,
        follow: false,
      ).clampToBounds(nowMs: 10_000, earliestMs: 0);
      expect(frozen.follow, isFalse);
      expect(frozen.endMs, 8_000);

      final atEdge = const LiveChartViewport(
        startMs: 0,
        endMs: 10_000,
        follow: false,
      ).clampToBounds(nowMs: 10_200, earliestMs: 0);
      expect(atEdge.follow, isTrue);
    });
  });

  testWidgets('renders multiple live series and axes', (tester) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 360,
            height: 260,
            child: LiveChart(
              initialWindowSeconds: 60,
              series: [
                LiveChartSeries(
                  id: 'a',
                  label: 'Motor current',
                  unit: 'mA',
                  color: Colors.teal,
                  rightAxis: true,
                  points: [
                    LiveChartPoint(now - 2000, 10),
                    LiveChartPoint(now - 1000, 12),
                    LiveChartPoint(now, 11),
                  ],
                  latest: 11,
                ),
                LiveChartSeries(
                  id: 'b',
                  label: 'Valve',
                  unit: '',
                  color: Colors.orange,
                  rightAxis: false,
                  points: [
                    LiveChartPoint(now - 2000, 0),
                    LiveChartPoint(now - 1000, 1),
                    LiveChartPoint(now, 1),
                  ],
                  latest: 1,
                ),
              ],
            ),
          ),
        ),
      ),
    );

    expect(find.byType(LiveChart), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows an empty state without frames', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(width: 360, height: 260, child: LiveChart(series: [])),
        ),
      ),
    );

    expect(find.text('Waiting for live frames…'), findsOneWidget);
  });

  testWidgets('followResetToken and window preset rebuild cleanly', (
    tester,
  ) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    var followEvents = <bool>[];
    var token = 0;
    var windowSeconds = 30;

    Widget buildChart() {
      return MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 360,
            height: 260,
            child: LiveChart(
              initialWindowSeconds: windowSeconds,
              followResetToken: token,
              onFollowChanged: followEvents.add,
              series: [
                LiveChartSeries(
                  id: 'a',
                  label: 'A',
                  unit: '',
                  color: Colors.teal,
                  rightAxis: false,
                  points: [
                    LiveChartPoint(now - 5000, 1),
                    LiveChartPoint(now, 2),
                  ],
                  latest: 2,
                ),
              ],
            ),
          ),
        ),
      );
    }

    await tester.pumpWidget(buildChart());
    await tester.pump();

    token = 1;
    windowSeconds = 60;
    await tester.pumpWidget(buildChart());
    await tester.pump();
    expect(followEvents, isNotEmpty);
    expect(followEvents.last, isTrue);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 1));
  });
}
