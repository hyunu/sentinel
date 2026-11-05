import 'package:flutter_test/flutter_test.dart';
import 'package:sentinel_mobile/ble/ble_scanner.dart';
import 'package:sentinel_mobile/models/board_status.dart';

void main() {
  const stale = BoardRegistryEntry(
    uid: '0015',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    isActive: true,
    lastHeartbeat: null,
  );

  test('BLE online wins over a stale server heartbeat', () {
    expect(
      BoardStatusResolver.resolveSignals(
        bleState: SentinelBleState.online,
        uid: '0015',
        serverEntry: stale,
      ),
      SentinelDisplayState.online,
    );
  });

  test('WiFi-up registering is not marked offline', () {
    expect(
      BoardStatusResolver.resolveSignals(
        bleState: SentinelBleState.registering,
        uid: '0015',
        serverEntry: stale,
      ),
      SentinelDisplayState.registering,
    );
  });

  test('recent heartbeat is online even without BLE flags', () {
    final fresh = BoardRegistryEntry(
      uid: '0015',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      isActive: true,
      lastHeartbeat: DateTime.now().toUtc(),
    );
    expect(
      BoardStatusResolver.resolveSignals(
        bleState: SentinelBleState.configured,
        uid: '0015',
        serverEntry: fresh,
      ),
      SentinelDisplayState.online,
    );
  });

  test('presence expires 10 seconds after the last packet', () {
    final fresh = DateTime.now().toUtc().subtract(const Duration(seconds: 9));
    final stale = DateTime.now().toUtc().subtract(const Duration(seconds: 11));
    expect(BoardStatusResolver.isRecent(fresh), isTrue);
    expect(BoardStatusResolver.isRecent(stale), isFalse);
  });

  test('UART newer than heartbeat is the presence time', () {
    final heartbeat = DateTime.utc(2026, 11, 5, 8, 34);
    final uart = DateTime.utc(2026, 11, 5, 8, 44);
    expect(freshestBoardPresence(heartbeat, uart), uart);
    expect(freshestBoardPresence(uart, heartbeat), uart);
    expect(freshestBoardPresence(null, uart), uart);
    expect(freshestBoardPresence(DateTime.utc(1), uart), uart);
  });

  test('known board without live link stays offline', () {
    expect(
      BoardStatusResolver.resolveSignals(
        bleState: SentinelBleState.configured,
        uid: '0015',
        serverEntry: stale,
      ),
      SentinelDisplayState.offline,
    );
  });
}
