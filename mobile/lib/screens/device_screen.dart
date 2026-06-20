import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:http/http.dart' as http;
import '../ble/ble_scanner.dart';
import '../services/storage_service.dart';

const String kBackendUrl = 'http://192.168.1.100:5050';

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

class _DeviceScreenState extends State<DeviceScreen> {
  final BleScanner _scanner = BleScanner();
  final StorageService _storage = StorageService();
  final _ssidCtrl = TextEditingController();
  final _passCtrl = TextEditingController();

  bool _connected = false;
  bool _wifiConfigured = false;
  List<String> _uartLogs = [];
  List<_Protocol> _protocols = [];
  String? _selectedProtoId;
  StreamSubscription? _uartSub;
  StreamSubscription? _connSub;
  bool _scanningUart = false;

  @override
  void initState() {
    super.initState();
    _loadSaved();
    _connect();
  }

  @override
  void dispose() {
    _uartSub?.cancel();
    _connSub?.cancel();
    _ssidCtrl.dispose();
    _passCtrl.dispose();
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
    }
  }

  Future<void> _connect() async {
    try {
      await widget.device.connect(timeout: const Duration(seconds: 10));
      if (mounted) setState(() => _connected = true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Connection failed: $e')),
        );
      }
      return;
    }

    _connSub = widget.device.connectionState.listen((s) {
      if (mounted) {
        setState(() => _connected = s == BluetoothConnectionState.connected);
      }
    });

    _loadProtocols();
  }

  Future<void> _loadProtocols() async {
    try {
      final res = await http.get(Uri.parse('$kBackendUrl/api/v1/protocols'));
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

    final ok = await _scanner.sendWifiConfig(
      widget.device,
      ssid: ssid,
      password: pass,
    );
    if (ok) {
      await _storage.saveWifiProfile(ssid, pass);
      if (mounted) {
        setState(() => _wifiConfigured = true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('WiFi credentials sent')),
        );
      }
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
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('UART stream failed: $e')),
        );
      }
    }
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
      result[f.name] = '${value}${f.unit ?? ''}';
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final selectedProto = _protocols.firstWhere(
      (p) => p.id == _selectedProtoId,
      orElse: () => _protocols.isNotEmpty ? _protocols.first : _Protocol.fromJson({'id': '', 'name': '', 'version': '', 'fields': []}),
    );
    final showParsed = selectedProto.fields.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.device.platformName.isNotEmpty
            ? widget.device.platformName
            : 'Sentinel Device'),
        backgroundColor: cs.surfaceContainerHighest,
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: _connected ? Colors.green.withValues(alpha: 0.1) : Colors.orange.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 5, height: 5,
                  decoration: BoxDecoration(
                    color: _connected ? Colors.green : Colors.orange,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  _connected ? 'Connected' : 'Connecting...',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w500,
                    color: _connected ? Colors.green.shade700 : Colors.orange.shade700,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildWifiCard(cs),
                  const SizedBox(height: 12),
                  if (!_scanningUart)
                    SizedBox(
                      height: 48,
                      child: FilledButton.icon(
                        onPressed: _connected ? _startUartStream : null,
                        icon: const Icon(Icons.play_arrow_rounded, size: 20),
                        label: const Text('Start UART Stream'),
                        style: FilledButton.styleFrom(
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    )
                  else
                    SizedBox(
                      height: 48,
                      child: FilledButton.tonalIcon(
                        onPressed: () {
                          _uartSub?.cancel();
                          _uartSub = null;
                          setState(() => _scanningUart = false);
                        },
                        icon: const Icon(Icons.stop_rounded, size: 20),
                        label: const Text('Stop UART Stream'),
                        style: FilledButton.styleFrom(
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                  const SizedBox(height: 12),
                  if (_protocols.isNotEmpty)
                    _buildProtocolSelector(cs, selectedProto, showParsed),
                  if (_uartLogs.isNotEmpty)
                    _buildUartLogs(cs, selectedProto, showParsed),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWifiCard(ColorScheme cs) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('WiFi Onboarding',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: cs.onSurface)),
          const SizedBox(height: 12),
          TextField(
            controller: _ssidCtrl,
            decoration: InputDecoration(
              hintText: 'WiFi SSID',
              prefixIcon: Icon(Icons.wifi, size: 20, color: cs.primary),
              filled: true,
              fillColor: cs.surfaceContainerHighest.withValues(alpha: 0.5),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _passCtrl,
            obscureText: true,
            decoration: InputDecoration(
              hintText: 'WiFi Password',
              prefixIcon: Icon(Icons.lock_outline, size: 20, color: cs.primary),
              filled: true,
              fillColor: cs.surfaceContainerHighest.withValues(alpha: 0.5),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: FilledButton.icon(
              onPressed: _connected ? _sendWifi : null,
              icon: const Icon(Icons.send_rounded, size: 18),
              label: Text(_wifiConfigured ? 'Resend' : 'Send WiFi'),
              style: FilledButton.styleFrom(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProtocolSelector(ColorScheme cs, _Protocol selectedProto, bool showParsed) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Protocol',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: cs.onSurface)),
          const SizedBox(height: 8),
          DropdownButton<String>(
            value: _selectedProtoId,
            hint: const Text('Select protocol'),
            isExpanded: true,
            items: _protocols.map((p) => DropdownMenuItem(
              value: p.id,
              child: Text('${p.name} v${p.version} (${p.fields.length} fields)'),
            )).toList(),
            onChanged: (v) => setState(() => _selectedProtoId = v),
          ),
          if (showParsed) ...[
            const SizedBox(height: 8),
            Text('Fields: ${selectedProto.fields.map((f) => f.name).join(', ')}',
                style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
          ],
        ],
      ),
    );
  }

  Widget _buildUartLogs(ColorScheme cs, _Protocol selectedProto, bool showParsed) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.8),
        borderRadius: BorderRadius.circular(12),
      ),
      constraints: const BoxConstraints(maxHeight: 400),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text(
                'UART Data (${_uartLogs.length})',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.6)),
              ),
              const Spacer(),
              GestureDetector(
                onTap: () => setState(() => _uartLogs.clear()),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Icon(Icons.delete_sweep, size: 16, color: cs.onSurfaceVariant.withValues(alpha: 0.4)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Expanded(
            child: ListView.builder(
              itemCount: _uartLogs.length,
              itemBuilder: (_, i) {
                final hex = _uartLogs[i];
                final parsed = showParsed ? _parseHex(hex, selectedProto) : <String, String>{};
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        hex,
                        style: const TextStyle(fontSize: 11, fontFamily: 'monospace', color: Colors.green),
                      ),
                      if (parsed.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(left: 8),
                          child: Text(
                            parsed.entries.map((e) => '${e.key}=${e.value}').join('  '),
                            style: const TextStyle(fontSize: 10, color: Colors.cyan),
                          ),
                        ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
