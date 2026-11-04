import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sentinel_mobile/widgets/live_chart.dart';

void main() {
  testWidgets('renders multiple live series and axes', (tester) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 360,
            height: 260,
            child: LiveChart(
              windowSeconds: 60,
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
}
