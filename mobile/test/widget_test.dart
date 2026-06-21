import 'package:flutter_test/flutter_test.dart';

import 'package:sentinel_mobile/main.dart';

void main() {
  testWidgets('App renders', (WidgetTester tester) async {
    await tester.pumpWidget(const SentinelApp());
    expect(find.text('Sentinel'), findsOneWidget);
  });
}
