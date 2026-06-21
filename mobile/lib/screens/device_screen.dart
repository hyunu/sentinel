import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:http/http.dart' as http;
import '../ble/ble_scanner.dart';
import '../services/storage_service.dart';

class _ProtocolField {
  final String name;
  final int offset;
  final int length;
  final String type;
  final String? unit;
  _ProtocolField(this.name, this.offset, this.length, this.type, this.unit);

  factory _ProtocolField.fromJson(Map<String, dynamic> j) {
    return _ProtocolField(
      j['name'] ?? '',
      j['offset'] ?? 0,
      j['length'] ?? 1,
      j['type'] ?? 'uint8',
      j['unit'],
    );
  }
}

class _Protocol {
  final String id;
  final String name;
  final String version;
  final List<_ProtocolField> fields;
  _Protocol(this.id, this.name, this.version, this.fields);

  factory _Protocol.fromJson(Map<String, dynamic> j) {
    return _Protocol(
      j['id'] ?? '',
      j['name'] ?? '',
      j['version'] ?? '',
      (j['fields'] as List)
          .map((f) => _ProtocolField.fromJson(f))
          .toList(),
    );
  }
}

class DeviceScreen extends StatefulWidget {
  final BluetoothDevice device;
  const DeviceScreen({super.key, required this.device});

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen>
    with SingleTickerProviderStateMixin {
  final BleScanner _scanner = BleScanner();
  final StorageService _storage = StorageService();
  final _ssidCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _baudCtrl = TextEditingController();
  final _urlCtrl = TextEditingController();

  bool _connected = false;
  bool _connecting = false;
  bool _wifiConfigured = false;
  bool _sendingWifi = false;
  List<String> _uartLogs = [];
  List<_Protocol> _protocols = [];
  String? _selectedProtoId;
  StreamSubscription? _uartSub;
  StreamSubscription? _connSub;
  bool _scanningUart = false;

  late TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
    _loadSaved();
    _connect();
  }

  @override
  void dispose() {
    _uartSub?.cancel();
    _connSub?.cancel();
    _ssidCtrl.dispose();
    _passCtrl.dispose();
    _baudCtrl.dispose();
    _urlCtrl.dispose();
    _tabCtrl.dispose();
    widget.device.disconnect();
    _scanner.clearCache();
    super.dispose();
  }

  Future<void> _loadSaved() async {
    final profiles = await _storage.getWifiProfiles();
    if (profiles.isNotEmpty) {
      final entry = profiles.entries.first;
      _ssidCtrl.text = entry.key;
      _passCtrl.text = entry.value;
    } else {
      _ssidCtrl.text = 'hyunu_2.4Ghz';
      _passCtrl.text = 'gusdn1006';
      _baudCtrl.text = '19200';
    }
    final url = await _storage.getServerUrl();
    if (url != null && url.isNotEmpty) {
      _urlCtrl.text = url;
    } else {
      _urlCtrl.text = 'http://192.168.0.9:5050';
    }
  }

  Future<void> _connect() async {
    setState(() => _connecting = true);
    try {
      await widget.device.disconnect().timeout(const Duration(seconds: 2));
    } catch (_) {}
    try {
      await widget.device.connect(timeout: const Duration(seconds: 10));
      await widget.device.connectionState
          .firstWhere((s) => s == BluetoothConnectionState.connected)
          .timeout(const Duration(seconds: 5));
      if (mounted) {
        setState(() {
          _connected = true;
          _connecting = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _connecting = false);
        _showSnack('Connection failed: $e');
      }
      return;
    }

    _connSub = widget.device.connectionState.listen((s) {
      if (mounted) {
        setState(() {
          _connected = s == BluetoothConnectionState.connected;
          if (!_connected) _connecting = false;
        });
      }
    });

    _loadProtocols();
  }

  Future<void> _loadProtocols() async {
    try {
      final base = _urlCtrl.text.isNotEmpty ? _urlCtrl.text : 'http://192.168.0.9:5050';
      final res = await http.get(Uri.parse('$base/api/v1/protocols'));
      if (res.statusCode == 200) {
        final list = json.decode(res.body) as List;
        if (mounted) {
          setState(() {
            _protocols = list.map((p) => _Protocol.fromJson(p)).toList();
          });
        }
      }
    } catch (_) {}
  }

  Future<void> _sendWifi() async {
    final ssid = _ssidCtrl.text.trim();
    final pass = _passCtrl.text.trim();
    if (ssid.isEmpty) return;

    setState(() => _sendingWifi = true);
    try {
      final baud = int.tryParse(_baudCtrl.text.trim());
      final url = _urlCtrl.text.trim();
      final baseUrl = url.isNotEmpty ? url : 'http://192.168.0.9:5050';

      // 1. Claim a UID from server before onboarding
      String? claimedUid;
      try {
        final claimRes = await http
            .post(Uri.parse('$baseUrl/api/v1/boards/claim'))
            .timeout(const Duration(seconds: 5));
        if (claimRes.statusCode == 200) {
          final body = json.decode(claimRes.body);
          claimedUid = body['uid'] as String?;
        } else {
          throw Exception('Claim failed: ${claimRes.statusCode}');
        }
      } catch (e) {
        throw Exception('Failed to claim UID: $e');
      }

      if (claimedUid == null || claimedUid.isEmpty) throw Exception('No UID claimed');

      // 2. Send config to device over BLE including claimed UID
      await _scanner.sendWifiConfig(
        widget.device,
        ssid: ssid,
        password: pass,
        baudRate: baud,
        serverUrl: url.isNotEmpty ? url : null,
        uid: claimedUid,
      );

      // 3. Wait for device to report WiFi connected and successful heartbeat via BLE logs
      final logStream = await _scanner.subscribeToLogs(widget.device);
      final wifiConnected = Completer<void>();
      final heartbeatOk = Completer<void>();
      final sub = logStream.listen((msg) {
        if (msg.contains('EVENT:WIFI_CONNECTED') && !wifiConnected.isCompleted) wifiConnected.complete();
        if (msg.contains('EVENT:HEARTBEAT_OK') && !heartbeatOk.isCompleted) heartbeatOk.complete();
      });

      try {
        // wait up to 30s for both signals
        await Future.wait([
          wifiConnected.future.timeout(const Duration(seconds: 30)),
          heartbeatOk.future.timeout(const Duration(seconds: 30)),
        ]);
      } catch (e) {
        await sub.cancel();
        throw Exception('Board did not become ready: $e');
      }
      await sub.cancel();

      // 4. Register device with server using claimed UID
      String? uid;
      try {
        final regRes = await http
            .post(
              Uri.parse('$baseUrl/api/v1/boards/register'),
              headers: {'Content-Type': 'application/json'},
              body: json.encode({
                'uid': claimedUid,
                'mac_address': widget.device.remoteId.str,
              }),
            )
            .timeout(const Duration(seconds: 5));
        if (regRes.statusCode == 201) {
          final regBody = json.decode(regRes.body);
          uid = regBody['uid'] as String?;
        } else {
          throw Exception('Register failed: ${regRes.statusCode}');
        }
      } catch (e) {
        throw Exception('Server registration failed: $e');
      }

      await _storage.saveWifiProfile(ssid, pass);
      if (url.isNotEmpty) await _storage.setServerUrl(url);

      if (mounted) {
        setState(() => _wifiConfigured = true);
        _showSnack('Configuration sent and registered${uid != null ? ' (uid: $uid)' : ''}');
      }
    } catch (e) {
      if (mounted) _showSnack('$e');
    } finally {
      if (mounted) setState(() => _sendingWifi = false);
    }
  }

  Future<void> _startUartStream() async {
    if (_uartSub != null) return;
    try {
      final stream = await _scanner.subscribeToUartData(widget.device);
      if (mounted) setState(() => _scanningUart = true);
      _uartSub = stream.listen((data) {
        if (!mounted) return;
        final hex = data.map((b) => b.toRadixString(16).padLeft(2, '0')).join(' ');
        setState(() {
          _uartLogs.add(hex);
          if (_uartLogs.length > 500) _uartLogs = _uartLogs.sublist(-500);
        });
      });
    } catch (e) {
      if (mounted) _showSnack('UART stream failed: $e');
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg, style: const TextStyle(fontSize: 13)),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  Map<String, String> _parseHex(String hex, _Protocol proto) {
    final bytes = <int>[];
    final clean = hex.replaceAll(' ', '');
    for (var i = 0; i < clean.length - 1; i += 2) {
      bytes.add(int.parse(clean.substring(i, i + 2), radix: 16));
    }
    final result = <String, String>{};
    for (final f in proto.fields) {
      if (f.offset + f.length > bytes.length) continue;
      final slice = bytes.sublist(f.offset, f.offset + f.length);
      String value;
      switch (f.type) {
        case 'uint8':
          value = '${slice[0]}';
          break;
        case 'uint16':
          value = '${(slice[0] << 8) | slice[1]}';
          break;
        case 'ascii':
          value = String.fromCharCodes(slice);
          break;
        default:
          value = slice.map((b) => b.toRadixString(16)).join(' ');
      }
      result[f.name] = '$value${f.unit ?? ''}';
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      body: Column(
        children: [
          _buildAppBar(cs),
          _buildTabs(cs),
          Expanded(
            child: TabBarView(
              controller: _tabCtrl,
              children: [
                _buildControlTab(cs),
                _buildDataTab(cs),
                _buildMonitorTab(cs),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAppBar(ColorScheme cs) {
    return Container(
      padding: EdgeInsets.only(top: MediaQuery.of(context).padding.top),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            cs.surface.withValues(alpha: 1),
            cs.surface.withValues(alpha: 0.95),
          ],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
        border: Border(bottom: BorderSide(color: cs.outline.withValues(alpha: 0.3), width: 0.5)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
        child: Column(
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.chevron_left, size: 28),
                  style: IconButton.styleFrom(
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        widget.device.platformName.isNotEmpty
                            ? widget.device.platformName
                            : 'Sentinel Device',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        widget.device.remoteId.str,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                          fontFamily: 'monospace',
                        ),
                      ),
                    ],
                  ),
                ),
                _buildStatusBadge(cs),
              ],
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusBadge(ColorScheme cs) {
    final (Color bg, Color dot, String label) = _connected
        ? (cs.primary.withValues(alpha: 0.1), cs.primary, 'Connected')
        : _connecting
            ? (cs.tertiary.withValues(alpha: 0.1), cs.tertiary, 'Connecting')
            : (cs.onSurfaceVariant.withValues(alpha: 0.06), cs.onSurfaceVariant.withValues(alpha: 0.3), 'Offline');

    return Container(
      margin: const EdgeInsets.only(right: 12),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6, height: 6,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: dot)),
        ],
      ),
    );
  }

  Widget _buildTabs(ColorScheme cs) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: cs.outline.withValues(alpha: 0.2), width: 0.5)),
      ),
      child: TabBar(
        controller: _tabCtrl,
        labelColor: cs.primary,
        unselectedLabelColor: cs.onSurfaceVariant.withValues(alpha: 0.5),
        indicatorColor: cs.primary,
        indicatorSize: TabBarIndicatorSize.tab,
        indicatorWeight: 2,
        labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
        tabs: const [
          Tab(text: 'Control'),
          Tab(text: 'Data'),
          Tab(text: 'Monitor'),
        ],
      ),
    );
  }

  /* ── Control Tab ────────────────────────────────────────────────── */

  Widget _buildControlTab(ColorScheme cs) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildSectionHeader(cs, 'Onboarding', Icons.tune_rounded),
          const SizedBox(height: 12),
          _buildGlassCard(cs, [
            _buildTextField(cs, _ssidCtrl, 'WiFi SSID', Icons.wifi_rounded),
            const SizedBox(height: 10),
            _buildTextField(cs, _passCtrl, 'WiFi Password', Icons.lock_rounded, obscure: true),
            const SizedBox(height: 10),
            _buildTextField(cs, _baudCtrl, 'Baud Rate', Icons.speed_rounded,
                placeholder: 'e.g. 115200'),
            const SizedBox(height: 10),
            _buildTextField(cs, _urlCtrl, 'Server URL', Icons.dns_rounded,
                placeholder: 'http://192.168.0.9:5050'),
            const SizedBox(height: 14),
            _buildSendButton(cs),
          ]),
          const SizedBox(height: 16),
          _buildSectionHeader(cs, 'Connection', Icons.bluetooth_rounded),
          const SizedBox(height: 12),
          _buildGlassCard(cs, [
            Row(
              children: [
                Container(
                  width: 36, height: 36,
                  decoration: BoxDecoration(
                    color: _connected
                        ? cs.primary.withValues(alpha: 0.1)
                        : cs.onSurfaceVariant.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    _connected ? Icons.bluetooth_connected : Icons.bluetooth_disabled,
                    size: 18,
                    color: _connected ? cs.primary : cs.onSurfaceVariant.withValues(alpha: 0.3),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Bluetooth LE', style: Theme.of(context).textTheme.bodyMedium),
                      Text(
                        _connected ? 'Connected and ready' : 'Not connected',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                        ),
                      ),
                    ],
                  ),
                ),
                if (!_connected && !_connecting)
                  TextButton(
                    onPressed: _connect,
                    child: const Text('Reconnect', style: TextStyle(fontSize: 12)),
                  ),
                if (_connecting)
                  const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
              ],
            ),
          ]),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(ColorScheme cs, String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 16, color: cs.onSurfaceVariant.withValues(alpha: 0.5)),
        const SizedBox(width: 8),
        Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(
          color: cs.onSurfaceVariant.withValues(alpha: 0.7),
        )),
      ],
    );
  }

  Widget _buildGlassCard(ColorScheme cs, List<Widget> children) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: cs.outline.withValues(alpha: 0.3), width: 0.5),
      ),
      child: Column(children: children),
    );
  }

  Widget _buildTextField(ColorScheme cs, TextEditingController ctrl, String label,
      IconData icon, {bool obscure = false, String? placeholder}) {
    return TextField(
      controller: ctrl,
      obscureText: obscure,
      style: TextStyle(fontSize: 14, color: cs.onSurface),
      decoration: InputDecoration(
        hintText: placeholder ?? label,
        prefixIcon: Icon(icon, size: 18, color: cs.primary.withValues(alpha: 0.6)),
        filled: true,
        fillColor: cs.surface.withValues(alpha: 0.5),
        hintStyle: TextStyle(color: cs.onSurfaceVariant.withValues(alpha: 0.4), fontSize: 13),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      ),
    );
  }

  Widget _buildSendButton(ColorScheme cs) {
    final canSend = _connected && _ssidCtrl.text.trim().isNotEmpty;
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: FilledButton.icon(
        onPressed: canSend && !_sendingWifi ? _sendWifi : null,
        icon: _sendingWifi
            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : Icon(_connected ? Icons.send_rounded : Icons.bluetooth_disabled, size: 18),
        label: Text(_sendingWifi
            ? 'Sending...'
            : _connected
                ? (_wifiConfigured ? 'Update Configuration' : 'Send Configuration')
                : (_connecting ? 'Connecting...' : 'Not Connected')),
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          backgroundColor: cs.primary,
          disabledBackgroundColor: cs.onSurfaceVariant.withValues(alpha: 0.06),
        ),
      ),
    );
  }

  /* ── Data Tab ───────────────────────────────────────────────────── */

  Widget _buildDataTab(ColorScheme cs) {
    final selectedProto = _protocols.firstWhere(
      (p) => p.id == _selectedProtoId,
      orElse: () => _protocols.isNotEmpty
          ? _protocols.first
          : _Protocol.fromJson({'id': '', 'name': '', 'version': '', 'fields': []}),
    );
    final showParsed = selectedProto.fields.isNotEmpty;

    if (_protocols.isEmpty && !_scanningUart) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 40),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 56, height: 56,
                decoration: BoxDecoration(
                  color: cs.primary.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(Icons.analytics_outlined, size: 24,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.3)),
              ),
              const SizedBox(height: 16),
              Text('No data yet', style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: cs.onSurface.withValues(alpha: 0.6),
              )),
              const SizedBox(height: 6),
              Text('Start the UART stream to\nview parsed data',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_protocols.isNotEmpty) ...[
            _buildSectionHeader(cs, 'Protocol', Icons.category_outlined),
            const SizedBox(height: 12),
            _buildGlassCard(cs, [
              DropdownButton<String>(
                value: _selectedProtoId,
                hint: Text('Select protocol',
                    style: TextStyle(color: cs.onSurfaceVariant.withValues(alpha: 0.5))),
                isExpanded: true,
                dropdownColor: cs.surfaceContainerHigh,
                underline: const SizedBox(),
                items: _protocols.map((p) => DropdownMenuItem(
                  value: p.id,
                  child: Text('${p.name} v${p.version} · ${p.fields.length} fields',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                )).toList(),
                onChanged: (v) => setState(() => _selectedProtoId = v),
              ),
              if (showParsed) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: cs.surface.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: selectedProto.fields.map((f) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(
                        children: [
                          Text(f.name, style: TextStyle(
                            fontSize: 12, color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                          )),
                          const Spacer(),
                          Text('${f.type}${f.unit != null ? " (${f.unit})" : ""}',
                              style: TextStyle(
                                fontSize: 11, fontFamily: 'monospace',
                                color: cs.primary.withValues(alpha: 0.6),
                              )),
                        ],
                      ),
                    )).toList(),
                  ),
                ),
              ],
            ]),
          ],
          const SizedBox(height: 16),
          _buildSectionHeader(cs, 'UART Stream', Icons.cell_tower_rounded),
          const SizedBox(height: 12),
          _buildGlassCard(cs, [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _scanningUart ? 'Streaming' : 'Idle',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      Text(
                        _scanningUart
                            ? '${_uartLogs.length} packets received'
                            : 'Start the stream to capture data',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  height: 40,
                  child: _scanningUart
                      ? FilledButton.tonalIcon(
                          onPressed: () {
                            _uartSub?.cancel();
                            _uartSub = null;
                            setState(() => _scanningUart = false);
                          },
                          icon: const Icon(Icons.stop_rounded, size: 16),
                          label: const Text('Stop', style: TextStyle(fontSize: 12)),
                          style: FilledButton.styleFrom(
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                        )
                      : FilledButton.icon(
                          onPressed: _connected ? _startUartStream : null,
                          icon: const Icon(Icons.play_arrow_rounded, size: 16),
                          label: const Text('Start', style: TextStyle(fontSize: 12)),
                          style: FilledButton.styleFrom(
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                        ),
                ),
              ],
            ),
          ]),
        ],
      ),
    );
  }

  /* ── Monitor Tab ────────────────────────────────────────────────── */

  Widget _buildMonitorTab(ColorScheme cs) {
    final selectedProto = _protocols.firstWhere(
      (p) => p.id == _selectedProtoId,
      orElse: () => _protocols.isNotEmpty
          ? _protocols.first
          : _Protocol.fromJson({'id': '', 'name': '', 'version': '', 'fields': []}),
    );
    final showParsed = selectedProto.fields.isNotEmpty;

    if (_uartLogs.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 40),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 56, height: 56,
                decoration: BoxDecoration(
                  color: cs.primary.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(Icons.terminal_rounded, size: 24,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.3)),
              ),
              const SizedBox(height: 16),
              Text('Monitor', style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: cs.onSurface.withValues(alpha: 0.6),
              )),
              const SizedBox(height: 6),
              Text('Start the UART stream from\nthe Data tab to monitor traffic',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
          child: Row(
            children: [
              Text(
                '${_uartLogs.length} packets',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                ),
              ),
              const Spacer(),
              GestureDetector(
                onTap: () => setState(() => _uartLogs.clear()),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.delete_sweep, size: 14,
                          color: cs.onSurfaceVariant.withValues(alpha: 0.5)),
                      const SizedBox(width: 4),
                      Text('Clear', style: TextStyle(
                        fontSize: 11, fontWeight: FontWeight.w500,
                        color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                      )),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
            itemCount: _uartLogs.length,
            itemBuilder: (_, i) {
              final hex = _uartLogs[i];
              final parsed = showParsed ? _parseHex(hex, selectedProto) : <String, String>{};
              final dir = hex.startsWith('01')
                  ? 'RX'
                  : hex.startsWith('02') ? 'TX' : null;

              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: cs.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: cs.outline.withValues(alpha: 0.2), width: 0.5),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (dir != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: dir == 'RX'
                                    ? cs.secondary.withValues(alpha: 0.12)
                                    : cs.primary.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(dir, style: TextStyle(
                                fontSize: 9, fontWeight: FontWeight.w700,
                                color: dir == 'RX' ? cs.secondary : cs.primary,
                                letterSpacing: 0.5,
                              )),
                            ),
                          const Spacer(),
                          Text(
                            'PKT #${_uartLogs.length - i}',
                            style: TextStyle(
                              fontSize: 9, fontFamily: 'monospace',
                              color: cs.onSurfaceVariant.withValues(alpha: 0.3),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        hex.replaceAll('01 ', '').replaceAll('02 ', ''),
                        style: TextStyle(
                          fontSize: 12,
                          fontFamily: 'monospace',
                          color: dir == 'RX' ? cs.secondary : cs.primary,
                          height: 1.3,
                        ),
                      ),
                      if (parsed.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: cs.surface.withValues(alpha: 0.5),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Wrap(
                            spacing: 12,
                            runSpacing: 4,
                            children: parsed.entries.map((e) => Text(
                              '${e.key}: ${e.value}',
                              style: TextStyle(
                                fontSize: 10,
                                color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                              ),
                            )).toList(),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
