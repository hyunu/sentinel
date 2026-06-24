import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:http/http.dart' as http;
import '../ble/ble_scanner.dart';
import '../models/board_status.dart';
import '../services/storage_service.dart';
import '../widgets/app_toast.dart';
import 'device_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {
  final BleScanner _scanner = BleScanner();
  final StorageService _storage = StorageService();

  List<ScanResult> _devices = [];
  Map<String, BoardRegistryEntry> _boardsByMac = {};
  Map<String, BoardRegistryEntry> _boardsByUid = {};
  bool _isScanning = false;
  StreamSubscription? _scanSub;
  Timer? _boardRefreshTimer;
  int _scanElapsed = 0;

  late AnimationController _pulseCtrl;
  late Animation<double> _pulseAnim;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat(reverse: true);
    _pulseAnim = Tween<double>(begin: 0.85, end: 1.0).animate(
      CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOutSine),
    );
    _startScan();
    _refreshBoardRegistry();
    _boardRefreshTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _refreshBoardRegistry();
    });
  }

  @override
  void dispose() {
    _scanSub?.cancel();
    _boardRefreshTimer?.cancel();
    _scanner.stopScan();
    _pulseCtrl.dispose();
    super.dispose();
  }

  Future<void> _startScan() async {
    if (!mounted) return;
    setState(() {
      _isScanning = true;
      _scanElapsed = 0;
    });

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
      setState(() {
        _devices = sentinelById.values.toList()
          ..sort((a, b) => b.rssi.compareTo(a.rssi));
      });
    });

    _tickScan();

    try {
      await _scanner.startScan();
    } catch (e) {
      debugPrint('Scan start failed: $e');
    }
  }

  void _tickScan() {
    Future.delayed(const Duration(seconds: 1), () {
      if (!_isScanning || !mounted) return;
      setState(() => _scanElapsed++);
      _tickScan();
    });
  }

  Future<void> _waitForBle() async {
    try {
      await FlutterBluePlus.adapterState
          .where((s) => s == BluetoothAdapterState.on)
          .first;
    } catch (_) {}
  }

  Future<void> _refreshBoardRegistry() async {
    try {
      final url = await _storage.getServerUrl();
      final baseUrl = (url != null && url.isNotEmpty) ? url : 'http://192.168.0.9:5050';
      final res = await http.get(Uri.parse('$baseUrl/api/v1/boards')).timeout(const Duration(seconds: 5));
      if (res.statusCode != 200 || !mounted) return;

      final byMac = <String, BoardRegistryEntry>{};
      final byUid = <String, BoardRegistryEntry>{};
      for (final raw in json.decode(res.body) as List) {
        if (raw is! Map) continue;
        final uid = raw['uid']?.toString() ?? '';
        if (uid.isEmpty) continue;
        final entry = BoardRegistryEntry(
          uid: uid,
          macAddress: raw['mac_address']?.toString() ?? '',
          isActive: raw['is_active'] == true,
          lastHeartbeat: DateTime.tryParse(raw['last_heartbeat']?.toString() ?? ''),
        );
        if (entry.macAddress.isNotEmpty) byMac[entry.macAddress] = entry;
        byUid[uid] = entry;
      }

      setState(() {
        _boardsByMac = byMac;
        _boardsByUid = byUid;
      });
    } catch (_) {}
  }

  BoardRegistryEntry? _serverEntryFor(ScanResult device) {
    final mac = device.device.remoteId.str;
    final uid = BleScanner.parseUidFromAdData(device.advertisementData);
    return _boardsByMac[mac] ?? (uid != null ? _boardsByUid[uid] : null);
  }

  void _showRegisteredNotice(String uid) {
    AppToast.success(context, 'Successfully registered $uid');
  }

  void _onDeviceSelected(ScanResult device) async {
    final registeredUid = await Navigator.push<String>(
      context,
      MaterialPageRoute(
        builder: (_) => DeviceScreen(
          device: device.device,
          advertisementData: device.advertisementData,
        ),
      ),
    );
    if (!mounted) return;
    if (registeredUid != null && registeredUid.isNotEmpty) {
      _showRegisteredNotice(registeredUid);
    }
    await _refreshBoardRegistry();
    _startScan();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(cs),
            _buildScanCard(cs),
            Expanded(
              child: _devices.isEmpty
                  ? _buildEmptyState(cs)
                  : _buildDeviceList(cs),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(ColorScheme cs) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF818CF8), Color(0xFFA78BFA)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.bluetooth_rounded, size: 18, color: Colors.white),
          ),
          const SizedBox(width: 12),
          Text('Sentinel', style: Theme.of(context).textTheme.titleLarge),
          const Spacer(),
          if (_devices.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: cs.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                '${_devices.length}',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: cs.primary),
              ),
            ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen())),
            icon: Icon(Icons.settings_rounded, size: 20),
            style: IconButton.styleFrom(
              backgroundColor: cs.surfaceContainerHigh.withValues(alpha: 0.5),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildScanCard(ColorScheme cs) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: AnimatedBuilder(
        animation: _pulseAnim,
        builder: (context, child) => Transform.scale(
          scale: _isScanning ? _pulseAnim.value : 1.0,
          child: child,
        ),
        child: Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                cs.primary.withValues(alpha: 0.08),
                cs.primary.withValues(alpha: 0.02),
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: cs.primary.withValues(alpha: _isScanning ? 0.2 : 0.06),
              width: 0.5,
            ),
          ),
          child: Row(
            children: [
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: _isScanning
                    ? SizedBox(
                        width: 28,
                        height: 28,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: cs.primary,
                        ),
                      )
                    : Icon(Icons.radar_rounded, size: 28, color: cs.onSurfaceVariant),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _isScanning ? 'Scanning' : 'Scan stopped',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: cs.onSurface,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _isScanning
                          ? '${_devices.length} device${_devices.length != 1 ? 's' : ''} found · ${_scanElapsed}s'
                          : 'Tap refresh to scan again',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                onPressed: _isScanning ? () {
                  _scanSub?.cancel();
                  _scanner.stopScan();
                  setState(() => _isScanning = false);
                } : _startScan,
                icon: Icon(
                  _isScanning ? Icons.stop_rounded : Icons.refresh_rounded,
                  size: 22,
                ),
                style: IconButton.styleFrom(
                  backgroundColor: cs.surfaceContainerHigh.withValues(alpha: 0.5),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState(ColorScheme cs) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    cs.primary.withValues(alpha: 0.08),
                    cs.primary.withValues(alpha: 0.02),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: cs.primary.withValues(alpha: 0.08), width: 0.5),
              ),
              child: Icon(
                _isScanning ? Icons.bluetooth_searching : Icons.bluetooth_disabled,
                size: 30,
                color: cs.onSurfaceVariant.withValues(alpha: 0.4),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              _isScanning ? 'Searching for devices' : 'No devices found',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: cs.onSurface.withValues(alpha: 0.7),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _isScanning
                  ? 'Make sure your device is powered on\nand in range'
                  : 'Tap refresh to start scanning',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDeviceList(ColorScheme cs) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
      itemCount: _devices.length,
      itemBuilder: (_, i) => _buildDeviceCard(cs, _devices[i]),
    );
  }

  Widget _buildDeviceCard(ColorScheme cs, ScanResult device) {
    final displayName = BleScanner.displayName(
      device.advertisementData,
      platformName: device.device.platformName,
    );
    final rssi = device.rssi;
    final strength = rssi >= -55
        ? 4
        : rssi >= -65 ? 3 : rssi >= -75 ? 2 : rssi >= -85 ? 1 : 0;
    final state = BoardStatusResolver.resolve(
      adData: device.advertisementData,
      deviceMac: device.device.remoteId.str,
      serverEntry: _serverEntryFor(device),
    );
    final stateLabel = BoardStatusResolver.label(state);
    final stateColor = BoardStatusResolver.color(state);

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _onDeviceSelected(device),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: cs.surfaceContainerLow,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: cs.outline.withValues(alpha: 0.4), width: 0.5),
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        cs.primary.withValues(alpha: 0.12),
                        cs.primary.withValues(alpha: 0.04),
                      ],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.bluetooth_rounded, color: cs.primary, size: 20),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        displayName,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: cs.onSurface,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        device.device.remoteId.str,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                          fontFamily: 'monospace',
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _buildSignalBars(cs, strength),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: stateColor.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: stateColor.withValues(alpha: 0.25)),
                      ),
                      child: Text(
                        stateLabel,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: stateColor,
                          letterSpacing: 0.3,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: 4),
                Icon(Icons.chevron_right, size: 18,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.2)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSignalBars(ColorScheme cs, int strength) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: List.generate(4, (i) {
        final h = 6.0 + i * 4.0;
        return Container(
          width: 4,
          height: h,
          margin: const EdgeInsets.only(right: 3),
          decoration: BoxDecoration(
            color: i < strength
                ? cs.primary.withValues(alpha: 0.6 + i * 0.1)
                : cs.outline.withValues(alpha: 0.15),
            borderRadius: const BorderRadius.all(Radius.circular(2)),
          ),
        );
      }),
    );
  }
}
