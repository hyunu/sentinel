import 'dart:async';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';

// Use Nordic UART Service (NUS) UUIDs to match nexio implementation
const String kUartServiceUuid = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const String kUartNotifyCharUuid = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const String kUartWriteCharUuid = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const String kUartMacCharUuid = '6e400004-b5a3-f393-e0a9-e50e24dcca9e';

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
    // Prefer advertisement local name when available (more up-to-date after adv change)
    final advName = r.advertisementData.advName;
    final name = advName.isNotEmpty
        ? advName
        : r.device.platformName;
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
    final ch = await _findChar(device, kUartNotifyCharUuid);
    if (ch == null) throw Exception('UART data characteristic not found');
    await ch.setNotifyValue(true);
    return ch.onValueReceived;
  }

  Future<Stream<String>> subscribeToLogs(BluetoothDevice device) async {
    final stream = await subscribeToUartData(device);
    return stream.transform(
      StreamTransformer<List<int>, String>.fromHandlers(
        handleData: (data, sink) {
          sink.add(String.fromCharCodes(data));
        },
      ),
    );
  }

  Future<String?> readWifiMac(BluetoothDevice device) async {
    final macCh = await _findChar(device, kUartMacCharUuid);
    if (macCh == null) return null;
    try {
      final value = await macCh.read();
      return String.fromCharCodes(value);
    } catch (_) {
      return null;
    }
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
      final writeCh = await _findChar(device, kUartWriteCharUuid);

      if (writeCh == null) throw Exception('WiFi config/write characteristic not found');

      final json = StringBuffer('{');
      json.write('"ssid":"${_escapeJson(ssid)}",');
      json.write('"password":"${_escapeJson(password)}"');
      if (baudRate != null && baudRate > 0) {
        json.write(',"baudRate":$baudRate');
      }
      if (serverUrl != null && serverUrl.isNotEmpty) {
        json.write(',"serverUrl":"${_escapeJson(serverUrl)}"');
      }
      if (uid != null && uid.isNotEmpty) {
        json.write(',"uniqueId":"${_escapeJson(uid)}"');
      }
      json.write('}');

      await writeCh.write(json.toString().codeUnits, withoutResponse: false).timeout(const Duration(seconds: 10));

      return true;
    } catch (e) {
      throw Exception('sendWifiConfig failed: $e');
    }
  }

  String _escapeJson(String s) {
    return s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  }
}
