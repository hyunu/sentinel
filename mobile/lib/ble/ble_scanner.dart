import 'dart:async';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';

const String kUartServiceUuid = '0000fff0-0000-1000-8000-00805f9b34fb';
const String kUartDataCharUuid = '0000ffe1-0000-1000-8000-00805f9b34fb';
const String kWifiSsidCharUuid = '0000ffe2-0000-1000-8000-00805f9b34fb';
const String kWifiPassCharUuid = '0000ffe3-0000-1000-8000-00805f9b34fb';

class BleScanner {
  final StreamController<List<ScanResult>> _scanController =
      StreamController<List<ScanResult>>.broadcast();
  StreamSubscription<List<ScanResult>>? _fbpSubscription;
  bool _isScanning = false;

  List<BluetoothService>? _cachedServices;
  Future<List<BluetoothService>>? _discoveryInProgress;

  Stream<List<ScanResult>> get scanResults => _scanController.stream;
  bool get isScanning => _isScanning;

  static bool isSentinelDevice(ScanResult r) {
    return true;
  }

  Future<List<BluetoothService>> discoverServices(BluetoothDevice device) async {
    if (_cachedServices != null) return _cachedServices!;
    if (_discoveryInProgress != null) return _discoveryInProgress!;
    _discoveryInProgress = device.discoverServices();
    _cachedServices = await _discoveryInProgress;
    _discoveryInProgress = null;
    return _cachedServices!;
  }

  void clearCache() {
    _cachedServices = null;
    _discoveryInProgress = null;
  }

  Future<void> startScan({Duration? timeout}) async {
    if (_isScanning) return;
    _fbpSubscription?.cancel();
    await FlutterBluePlus.startScan(timeout: timeout);
    _fbpSubscription = FlutterBluePlus.scanResults.listen((results) {
      _scanController.add(results);
    });
    _isScanning = true;
  }

  Future<void> stopScan() async {
    if (!_isScanning) return;
    _fbpSubscription?.cancel();
    _fbpSubscription = null;
    await FlutterBluePlus.stopScan();
    _isScanning = false;
  }

  Future<BluetoothCharacteristic?> _findChar(
    BluetoothDevice device,
    String charUuid,
  ) async {
    final services = await discoverServices(device);
    for (final svc in services) {
      for (final ch in svc.characteristics) {
        if (ch.uuid.str.toLowerCase() == charUuid.toLowerCase()) {
          return ch;
        }
      }
    }
    return null;
  }

  Future<Stream<List<int>>> subscribeToUartData(BluetoothDevice device) async {
    final ch = await _findChar(device, kUartDataCharUuid);
    if (ch == null) throw Exception('UART data characteristic not found');
    await ch.setNotifyValue(true);
    return ch.onValueReceived;
  }

  Future<bool> sendWifiConfig(
    BluetoothDevice device, {
    required String ssid,
    required String password,
  }) async {
    try {
      final ssidCh = await _findChar(device, kWifiSsidCharUuid);
      final passCh = await _findChar(device, kWifiPassCharUuid);
      if (ssidCh != null) {
        await ssidCh.write(ssid.codeUnits);
      }
      if (passCh != null) {
        await passCh.write(password.codeUnits);
      }
      return true;
    } catch (_) {
      return false;
    }
  }
}
