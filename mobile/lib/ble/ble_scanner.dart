import 'dart:async';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';

const String kUartServiceUuid = '0000ffe0-0000-1000-8000-00805f9b34fb';
const String kUartDataCharUuid = '5f9b34fb-0080-8000-0010-0000e1ff0000';
const String kWifiSsidCharUuid = '5f9b34fb-0080-8000-0010-0000e2ff0000';
const String kWifiPassCharUuid = '5f9b34fb-0080-8000-0010-0000e3ff0000';

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
    final name = r.device.platformName.isNotEmpty
        ? r.device.platformName
        : r.advertisementData.advName;
    return name.toLowerCase().startsWith('sentinel');
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
    int? baudRate,
    String? serverUrl,
    String? uid,
  }) async {
    try {
      clearCache();
      final passCh = await _findChar(device, kWifiPassCharUuid);

      if (passCh == null) throw Exception('WiFi config characteristic not found');

      final json = StringBuffer('{');
      json.write('"ssid":"${_escapeJson(ssid)}",');
      json.write('"password":"${_escapeJson(password)}"');
      if (baudRate != null && baudRate > 0) {
        json.write(',"baudRate":$baudRate');
      }
      if (serverUrl != null && serverUrl.isNotEmpty) {
        json.write(',"url":"${_escapeJson(serverUrl)}"');
      }
      if (uid != null && uid.isNotEmpty) {
        json.write(',"uid":"${_escapeJson(uid)}"');
      }
      json.write('}');

      await passCh.write(json.toString().codeUnits, withoutResponse: false).timeout(const Duration(seconds: 10));

      return true;
    } catch (e) {
      throw Exception('sendWifiConfig failed: $e');
    }
  }

  String _escapeJson(String s) {
    return s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  }
}
