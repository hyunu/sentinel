import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../ble/ble_scanner.dart';
import 'device_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final BleScanner _scanner = BleScanner();

  List<ScanResult> _devices = [];
  bool _isScanning = false;
  StreamSubscription? _scanSub;

  @override
  void initState() {
    super.initState();
    _startScan();
  }

  @override
  void dispose() {
    _scanSub?.cancel();
    _scanner.stopScan();
    super.dispose();
  }

  Future<void> _startScan() async {
    if (!mounted) return;
    setState(() => _isScanning = true);

    await _waitForBle();

    _scanSub?.cancel();
    try {
      await _scanner.stopScan();
    } catch (_) {}

    _scanSub = _scanner.scanResults.listen((results) {
      if (!mounted) return;
      final Map<String, ScanResult> sentinelById = {};
      for (final r in results) {
        if (BleScanner.isSentinelDevice(r)) {
          sentinelById[r.device.remoteId.str] = r;
        }
      }
      final Map<String, ScanResult> merged = {};
      for (final d in _devices) {
        merged[d.device.remoteId.str] = d;
      }
      merged.addAll(sentinelById);

      setState(() {
        _devices = merged.values.toList()
          ..sort((a, b) => b.rssi.compareTo(a.rssi));
      });
    });

    try {
      await _scanner.startScan();
    } catch (e) {
      debugPrint('Scan start failed: $e');
      _scanSub?.cancel();
      if (mounted) setState(() => _isScanning = false);
    }
  }

  Future<void> _waitForBle() async {
    try {
      await FlutterBluePlus.adapterState
          .where((s) => s == BluetoothAdapterState.on)
          .first;
    } catch (_) {}
  }

  void _onDeviceSelected(ScanResult device) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DeviceScreen(device: device.device),
      ),
    );
    if (mounted) _startScan();
  }

  Widget _buildRssiIndicator(int rssi) {
    final int bars;
    final Color barColor;
    if (rssi >= -55) {
      bars = 4;
      barColor = const Color(0xFF00C853);
    } else if (rssi >= -65) {
      bars = 3;
      barColor = const Color(0xFF69F0AE);
    } else if (rssi >= -75) {
      bars = 2;
      barColor = const Color(0xFFFFB300);
    } else if (rssi >= -85) {
      bars = 1;
      barColor = const Color(0xFFFF6D00);
    } else {
      bars = 0;
      barColor = const Color(0xFFFF1744);
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: List.generate(4, (i) {
        final height = 5.0 + i * 3.0;
        return Container(
          width: 3.5,
          height: height,
          margin: const EdgeInsets.only(right: 2.5),
          decoration: BoxDecoration(
            color: i < bars ? barColor : Colors.grey.shade300,
            borderRadius: BorderRadius.circular(2),
          ),
        );
      }),
    );
  }

  Widget _buildDeviceCard(ScanResult device) {
    final cs = Theme.of(context).colorScheme;
    final name = device.device.platformName.isNotEmpty
        ? device.device.platformName
        : device.advertisementData.advName;
    final displayName = name.isNotEmpty ? name : 'Sentinel Device';

    return Card(
      key: ValueKey(device.device.remoteId.str),
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: cs.outlineVariant, width: 0.5),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _onDeviceSelected(device),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: cs.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.bluetooth, color: cs.primary, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      displayName,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      device.device.remoteId.str,
                      style: TextStyle(
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildRssiIndicator(device.rssi),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: cs.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      'UART',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: cs.primary,
                        height: 1.2,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 4),
              Icon(Icons.chevron_right, size: 18,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.3)),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sentinel'),
        backgroundColor: cs.surfaceContainerHighest,
      ),
      body: Column(
        children: [
          Container(
            height: 52,
            padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Text(
                    _devices.isEmpty
                        ? 'Scanning for BLE devices...'
                        : '${_devices.length} device${_devices.length != 1 ? 's' : ''} found',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: cs.onSurfaceVariant,
                    ),
                  ),
                ),
                if (_isScanning)
                  _buildScanningIndicator(cs)
                else
                  IconButton(
                    icon: const Icon(Icons.refresh_rounded, size: 22),
                    onPressed: _startScan,
                    style: IconButton.styleFrom(
                      backgroundColor: cs.surfaceContainerHighest.withValues(alpha: 0.5),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: _devices.isEmpty
                ? _buildEmptyState(cs)
                : ListView.builder(
                    padding: const EdgeInsets.only(top: 4, bottom: 20),
                    itemCount: _devices.length,
                    itemBuilder: (_, i) => _buildDeviceCard(_devices[i]),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildScanningIndicator(ColorScheme cs) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: cs.primary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: cs.primary,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            'Scanning',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: cs.primary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(ColorScheme cs) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: cs.surfaceContainerHighest.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Icon(
              _isScanning ? Icons.bluetooth_searching : Icons.bluetooth_disabled,
              size: 28,
              color: cs.onSurfaceVariant.withValues(alpha: 0.4),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            _isScanning ? 'Searching...' : 'No BLE devices found',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w500,
              color: cs.onSurfaceVariant.withValues(alpha: 0.8),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            _isScanning
                ? 'Make sure your device is powered on and in range'
                : 'Tap refresh to scan again',
            style: TextStyle(
              fontSize: 13,
              color: cs.onSurfaceVariant.withValues(alpha: 0.5),
            ),
          ),
        ],
      ),
    );
  }
}
