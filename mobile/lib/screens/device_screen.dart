import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:http/http.dart' as http;
import '../ble/ble_scanner.dart';
import '../models/onboarding_profile.dart';
import '../services/onboarding_profiler.dart';
import '../services/storage_service.dart';
import '../widgets/app_toast.dart';

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
  final AdvertisementData? advertisementData;
  const DeviceScreen({
    super.key,
    required this.device,
    this.advertisementData,
  });

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen>
    with SingleTickerProviderStateMixin {
  final BleScanner _scanner = BleScanner();
  final StorageService _storage = StorageService();
  final OnboardingProfiler _onboardingProfiler = OnboardingProfiler();
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
  List<OnboardingProfile> _onboardingProfiles = [];
  String? _selectedProfileId;

  late TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
    _onboardingProfiler.addListener(_onProfilerUpdated);
    for (final c in [_ssidCtrl, _passCtrl, _baudCtrl, _urlCtrl]) {
      c.addListener(_onFieldChanged);
    }
    _loadSaved();
    _connect();
  }

  void _onFieldChanged() {
    if (mounted) setState(() {});
  }

  void _onProfilerUpdated() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _onboardingProfiler.removeListener(_onProfilerUpdated);
    for (final c in [_ssidCtrl, _passCtrl, _baudCtrl, _urlCtrl]) {
      c.removeListener(_onFieldChanged);
    }
    _uartSub?.cancel();
    _connSub?.cancel();
    _ssidCtrl.dispose();
    _passCtrl.dispose();
    _baudCtrl.dispose();
    _urlCtrl.dispose();
    _tabCtrl.dispose();
    _onboardingProfiler.dispose();
    widget.device.disconnect();
    _scanner.clearCache();
    super.dispose();
  }

  Future<void> _loadSaved() async {
    await _loadOnboardingProfiles();
    if (_onboardingProfiles.isEmpty) {
      _ssidCtrl.text = 'hyunu_2.4Ghz';
      _passCtrl.text = 'gusdn1006';
      _baudCtrl.text = '19200';
      _urlCtrl.text = 'http://192.168.0.9:5050';
    }
  }

  Future<void> _loadOnboardingProfiles({String? selectId}) async {
    final profiles = await _storage.getOnboardingProfiles();
    final lastId = selectId ?? await _storage.getLastOnboardingProfileId();
    OnboardingProfile? selected;
    if (lastId != null) {
      for (final p in profiles) {
        if (p.id == lastId) {
          selected = p;
          break;
        }
      }
    }
    selected ??= profiles.isNotEmpty ? profiles.first : null;

    if (!mounted) return;
    setState(() {
      _onboardingProfiles = profiles;
      _selectedProfileId = selected?.id;
    });

    if (selected != null) {
      _applyProfile(selected, notify: false);
    } else {
      final url = await _storage.getServerUrl();
      if (url != null && url.isNotEmpty && mounted) {
        _urlCtrl.text = url;
      }
    }
  }

  void _applyProfile(OnboardingProfile profile, {bool notify = true}) {
    _ssidCtrl.text = profile.ssid;
    _passCtrl.text = profile.password;
    _urlCtrl.text = profile.serverUrl;
    _baudCtrl.text = profile.baudRate?.toString() ?? '19200';
    if (notify && mounted) {
      setState(() => _selectedProfileId = profile.id);
    }
    _storage.setLastOnboardingProfileId(profile.id);
  }

  void _selectProfile(OnboardingProfile profile) {
    _applyProfile(profile);
  }

  OnboardingProfile? get _selectedProfile {
    if (_selectedProfileId == null) return null;
    for (final p in _onboardingProfiles) {
      if (p.id == _selectedProfileId) return p;
    }
    return null;
  }

  bool get _profileDirty {
    final selected = _selectedProfile;
    final ssid = _ssidCtrl.text.trim();
    final pass = _passCtrl.text.trim();
    final url = _urlCtrl.text.trim();
    final baud = int.tryParse(_baudCtrl.text.trim());
    if (selected == null) {
      return ssid.isNotEmpty || pass.isNotEmpty || url.isNotEmpty;
    }
    return selected.ssid != ssid ||
        selected.password != pass ||
        selected.serverUrl != url ||
        selected.baudRate != baud;
  }

  String _shortUrl(String url) {
    if (url.isEmpty) return 'No server';
    return url.replaceFirst(RegExp(r'^https?://'), '');
  }

  OnboardingProfile _profileFromFields({String? id, String? name}) {
    final baud = int.tryParse(_baudCtrl.text.trim());
    return OnboardingProfile(
      id: id ?? 'p${DateTime.now().millisecondsSinceEpoch}',
      name: name ?? _ssidCtrl.text.trim(),
      ssid: _ssidCtrl.text.trim(),
      password: _passCtrl.text.trim(),
      serverUrl: _urlCtrl.text.trim(),
      baudRate: baud,
      updatedAt: DateTime.now(),
    );
  }

  Future<void> _updateCurrentProfile() async {
    final selected = _selectedProfile;
    if (selected == null) {
      await _promptSaveProfile();
      return;
    }
    await _persistCurrentProfile();
    if (mounted) AppToast.success(context, 'Profile "${selected.name}" updated');
  }

  Future<void> _persistCurrentProfile() async {
    final ssid = _ssidCtrl.text.trim();
    if (ssid.isEmpty) return;

    OnboardingProfile? existing;
    if (_selectedProfileId != null) {
      for (final p in _onboardingProfiles) {
        if (p.id == _selectedProfileId) {
          existing = p;
          break;
        }
      }
    }

    final profile = _profileFromFields(
      id: existing?.id,
      name: existing?.name ?? ssid,
    );
    await _storage.saveOnboardingProfile(profile);
    if (_urlCtrl.text.trim().isNotEmpty) {
      await _storage.setServerUrl(_urlCtrl.text.trim());
    }
    await _loadOnboardingProfiles(selectId: profile.id);
  }

  Future<void> _promptSaveProfile() async {
    final ssid = _ssidCtrl.text.trim();
    if (ssid.isEmpty) {
      AppToast.error(context, 'Enter a WiFi SSID before saving a profile.', persistent: false);
      return;
    }

    final nameCtrl = TextEditingController(text: ssid);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        final cs = Theme.of(ctx).colorScheme;
        return AlertDialog(
          backgroundColor: cs.surfaceContainerHigh,
          title: const Text('Save onboarding profile'),
          content: TextField(
            controller: nameCtrl,
            decoration: const InputDecoration(
              labelText: 'Profile name',
              hintText: 'e.g. Home lab',
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
          ],
        );
      },
    );

    if (saved != true || !mounted) return;
    final name = nameCtrl.text.trim().isEmpty ? ssid : nameCtrl.text.trim();
    nameCtrl.dispose();

    final profile = _profileFromFields(id: _selectedProfileId, name: name);
    await _storage.saveOnboardingProfile(profile);
    if (_urlCtrl.text.trim().isNotEmpty) {
      await _storage.setServerUrl(_urlCtrl.text.trim());
    }
    await _loadOnboardingProfiles(selectId: profile.id);
    if (mounted) AppToast.success(context, 'Profile "$name" saved');
  }

  Future<void> _confirmDeleteProfile(OnboardingProfile profile) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete profile'),
        content: Text('Delete "${profile.name}"?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _storage.deleteOnboardingProfile(profile.id);
    await _loadOnboardingProfiles();
    if (mounted) AppToast.info(context, 'Profile deleted');
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
        _showError('Could not connect to the device.');
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

  Future<bool> _serverHasRecentHeartbeat(
    String baseUrl,
    String uid, {
    required DateTime since,
    DateTime? newerThan,
  }) async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/api/v1/boards'))
          .timeout(const Duration(seconds: 5));
      if (res.statusCode != 200) return false;

      for (final raw in json.decode(res.body) as List) {
        if (raw is! Map || raw['uid'] != uid) continue;
        final hbRaw = raw['last_heartbeat'];
        if (hbRaw == null) continue;
        final hb = DateTime.tryParse(hbRaw.toString());
        if (hb == null || hb.year <= 1) continue;
        final hbUtc = hb.toUtc();
        if (newerThan != null && !hbUtc.isAfter(newerThan.toUtc())) continue;
        if (!hbUtc.isBefore(since.toUtc().subtract(const Duration(seconds: 5)))) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  Future<void> _waitForBoardReady({
    required String baseUrl,
    required String uid,
    required DateTime since,
    required Completer<void> heartbeatOk,
    DateTime? newerThan,
    Duration timeout = const Duration(seconds: 90),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      if (heartbeatOk.isCompleted) return;
      if (await _serverHasRecentHeartbeat(
        baseUrl,
        uid,
        since: since,
        newerThan: newerThan,
      )) {
        if (!heartbeatOk.isCompleted) heartbeatOk.complete();
        return;
      }
      await Future.delayed(const Duration(seconds: 2));
    }
    if (!heartbeatOk.isCompleted) {
      throw TimeoutException('heartbeat not received within ${timeout.inSeconds}s');
    }
  }

  DateTime? _lastHeartbeatForUid(List boards, String uid) {
    for (final raw in boards) {
      if (raw is! Map || raw['uid'] != uid) continue;
      final hb = DateTime.tryParse(raw['last_heartbeat']?.toString() ?? '');
      if (hb != null && hb.year > 1) return hb;
    }
    return null;
  }

  String? _findExistingUidForMac(List boards, String bleMac, {String? wifiMac}) {
    String? bestUid;
    int? bestNum;
    final wifiNorm = wifiMac?.replaceAll(':', '').toLowerCase();
    for (final raw in boards) {
      if (raw is! Map) continue;
      final boardBle = raw['mac_address']?.toString() ?? '';
      final boardWifi = raw['wifi_mac']?.toString() ?? '';
      final boardWifiNorm = boardWifi.replaceAll(':', '').toLowerCase();
      final bleMatch = boardBle.isNotEmpty && boardBle == bleMac;
      final wifiMatch = wifiNorm != null &&
          wifiNorm.isNotEmpty &&
          boardWifiNorm.isNotEmpty &&
          boardWifiNorm == wifiNorm;
      if (!bleMatch && !wifiMatch) continue;
      final uid = raw['uid']?.toString();
      if (uid == null || uid.isEmpty) continue;
      final num = int.tryParse(uid);
      if (num == null) continue;
      if (bestNum == null || num < bestNum) {
        bestNum = num;
        bestUid = uid;
      }
    }
    return bestUid;
  }

  Future<String?> _claimUid(String baseUrl, String bleMac, {String? wifiMac}) async {
    final claimRes = await http
        .post(
          Uri.parse('$baseUrl/api/v1/boards/claim'),
          headers: {'Content-Type': 'application/json'},
          body: json.encode({
            'mac_address': bleMac,
            if (wifiMac != null && wifiMac.isNotEmpty) 'wifi_mac': wifiMac,
          }),
        )
        .timeout(const Duration(seconds: 5));
    if (claimRes.statusCode == 200) {
      final body = json.decode(claimRes.body);
      return body['uid'] as String?;
    }
    throw Exception('Claim failed: ${claimRes.statusCode}');
  }

  Future<void> _sendWifi() async {
    final ssid = _ssidCtrl.text.trim();
    final pass = _passCtrl.text.trim();
    if (ssid.isEmpty) return;

    _onboardingProfiler.begin();
    setState(() => _sendingWifi = true);
    try {
      final baud = int.tryParse(_baudCtrl.text.trim());
      final url = _urlCtrl.text.trim();
      final baseUrl = url.isNotEmpty ? url : 'http://192.168.0.9:5050';

      _onboardingProfiler.startStep('server_reachable');
      try {
        final pingRes =
            await http.get(Uri.parse('$baseUrl/api/v1/protocols')).timeout(const Duration(seconds: 3));
        if (pingRes.statusCode < 200 || pingRes.statusCode >= 400) {
          _onboardingProfiler.finishFailure('server_reachable', note: 'HTTP ${pingRes.statusCode}');
          if (mounted) _showError('Cannot reach the server. Check the server URL.');
          return;
        }
        _onboardingProfiler.completeStep('server_reachable');
      } catch (e) {
        _onboardingProfiler.finishFailure('server_reachable', note: '$e');
        if (mounted) _showError('Cannot reach the server. Check the server URL.');
        return;
      }

      final bleMac = widget.device.remoteId.str;
      String? wifiMac;
      try {
        wifiMac = await _scanner.readWifiMac(widget.device);
      } catch (_) {}

      String? claimedUid;
      DateTime? heartbeatBaseline;

      _onboardingProfiler.startStep('uid_claimed');
      try {
        final boardsRes = await http.get(Uri.parse('$baseUrl/api/v1/boards')).timeout(const Duration(seconds: 5));
        if (boardsRes.statusCode == 200) {
          final boards = json.decode(boardsRes.body) as List;
          claimedUid = _findExistingUidForMac(boards, bleMac, wifiMac: wifiMac);
          if (claimedUid != null) {
            heartbeatBaseline = _lastHeartbeatForUid(boards, claimedUid);
          }
        }
      } catch (_) {}

      try {
        claimedUid ??= await _claimUid(baseUrl, bleMac, wifiMac: wifiMac);
      } catch (e) {
        _onboardingProfiler.finishFailure('uid_claimed', note: '$e');
        rethrow;
      }

      if (claimedUid == null || claimedUid.isEmpty) {
        _onboardingProfiler.finishFailure('uid_claimed', note: 'empty uid');
        throw Exception('No UID claimed');
      }
      _onboardingProfiler.completeStep('uid_claimed', note: claimedUid);
      final claimTime = DateTime.now();

      final heartbeatOk = Completer<void>();
      var configSent = false;
      StreamSubscription<String>? logSub;

      _onboardingProfiler.startStep('ble_subscribed');
      try {
        final logStream = await _scanner.subscribeToLogs(widget.device);
        _onboardingProfiler.completeStep('ble_subscribed');
        logSub = logStream.listen((msg) {
          debugPrint('[BLE LOG] $msg');
          _onboardingProfiler.markBleEvent(msg);
          if (!configSent) return;
          if (msg.contains('EVENT:HEARTBEAT_OK') && !heartbeatOk.isCompleted) {
            heartbeatOk.complete();
          }
        });
      } catch (e) {
        _onboardingProfiler.finishFailure('ble_subscribed', note: '$e');
        debugPrint('BLE log subscribe failed: $e');
      }

      _onboardingProfiler.startStep('config_sent');
      await _scanner.sendWifiConfig(
        widget.device,
        ssid: ssid,
        password: pass,
        baudRate: baud,
        serverUrl: url.isNotEmpty ? url : null,
        uid: claimedUid,
      );
      configSent = true;
      _onboardingProfiler.completeStep('config_sent', note: claimedUid);

      _onboardingProfiler.startStep('board_ready');
      await _waitForBoardReady(
        baseUrl: baseUrl,
        uid: claimedUid,
        since: claimTime,
        newerThan: heartbeatBaseline,
        heartbeatOk: heartbeatOk,
      );
      _onboardingProfiler.completeStep('board_ready');
      await logSub?.cancel();

      _onboardingProfiler.startStep('registered');
      String? uid;
      try {
        final regRes = await http
            .post(
              Uri.parse('$baseUrl/api/v1/boards/register'),
              headers: {'Content-Type': 'application/json'},
              body: json.encode({
                'uid': claimedUid,
                'mac_address': bleMac,
                if (wifiMac != null && wifiMac.isNotEmpty) 'wifi_mac': wifiMac,
              }),
            )
            .timeout(const Duration(seconds: 5));
        if (regRes.statusCode == 201) {
          final regBody = json.decode(regRes.body);
          uid = regBody['uid'] as String?;
          _onboardingProfiler.completeStep('registered', note: uid);
        } else {
          _onboardingProfiler.finishFailure('registered', note: 'HTTP ${regRes.statusCode}');
          throw Exception('Register failed: ${regRes.statusCode}');
        }
      } catch (e) {
        if (!_onboardingProfiler.hasFailed) {
          _onboardingProfiler.finishFailure('registered', note: '$e');
        }
        throw Exception('Server registration failed: $e');
      }

      await _storage.saveWifiProfile(ssid, pass);
      if (url.isNotEmpty) await _storage.setServerUrl(url);
      await _persistCurrentProfile();

      _onboardingProfiler.finishSuccess(uid: uid ?? claimedUid);

      if (mounted) {
        setState(() => _wifiConfigured = true);
        _scanner.clearCache();
        Navigator.pop(context, uid ?? claimedUid);
      }
    } catch (e) {
      if (!_onboardingProfiler.hasFailed) {
        _onboardingProfiler.finishFailure('board_ready', note: '$e');
      }
      if (mounted) _showError(_onboardingErrorMessage(e));
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
      if (mounted) _showError('Failed to start the UART stream.');
    }
  }

  String _onboardingErrorMessage(Object error) {
    if (error is TimeoutException) {
      return 'The board did not connect to the server. Check WiFi and server settings.';
    }
    final msg = error.toString();
    if (msg.contains('Claim failed')) {
      return 'Could not claim a board ID from the server.';
    }
    if (msg.contains('No UID claimed')) {
      return 'Could not obtain a board ID from the server.';
    }
    if (msg.contains('Register failed') || msg.contains('Server registration failed')) {
      return 'Server registration failed. Try again.';
    }
    if (msg.contains('sendWifiConfig failed')) {
      return 'Failed to send configuration over Bluetooth.';
    }
    return 'Onboarding failed. Please try again.';
  }

  void _showError(String message) {
    AppToast.error(context, message);
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
                        BleScanner.displayName(
                          widget.advertisementData ??
                              AdvertisementData(
                                advName: widget.device.platformName,
                                txPowerLevel: null,
                                appearance: null,
                                connectable: true,
                                manufacturerData: const {},
                                serviceUuids: const [],
                                serviceData: const {},
                              ),
                          platformName: widget.device.platformName,
                        ),
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
          _buildOnboardingProfilesSection(cs),
          const SizedBox(height: 12),
          _buildGlassCard(cs, [
            _buildFormGroupLabel(cs, 'Network'),
            const SizedBox(height: 8),
            _buildTextField(cs, _ssidCtrl, 'WiFi SSID', Icons.wifi_rounded),
            const SizedBox(height: 10),
            _buildTextField(cs, _passCtrl, 'WiFi Password', Icons.lock_rounded, obscure: true),
            const SizedBox(height: 16),
            _buildFormGroupLabel(cs, 'Device'),
            const SizedBox(height: 8),
            _buildTextField(cs, _baudCtrl, 'Baud Rate', Icons.speed_rounded,
                placeholder: 'e.g. 115200'),
            const SizedBox(height: 16),
            _buildFormGroupLabel(cs, 'Server'),
            const SizedBox(height: 8),
            _buildTextField(cs, _urlCtrl, 'Server URL', Icons.dns_rounded,
                placeholder: 'http://192.168.0.9:5050'),
            if (_profileDirty) ...[
              const SizedBox(height: 14),
              _buildProfileDirtyBanner(cs),
            ],
            const SizedBox(height: 16),
            _buildSendButton(cs),
          ]),
          if (_onboardingProfiler.steps.isNotEmpty) ...[
            const SizedBox(height: 16),
            _buildSectionHeader(cs, 'Step Timeline', Icons.timeline_rounded),
            const SizedBox(height: 12),
            _buildOnboardingProfileCard(cs),
          ],
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

  Widget _buildOnboardingProfilesSection(ColorScheme cs) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            cs.primary.withValues(alpha: 0.07),
            cs.primary.withValues(alpha: 0.02),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: cs.outline.withValues(alpha: 0.25), width: 0.5),
      ),
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: cs.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(Icons.layers_rounded, size: 15, color: cs.primary),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Profiles',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                    Text(
                      _onboardingProfiles.isEmpty
                          ? 'Save presets for quick onboarding'
                          : '${_onboardingProfiles.length} saved',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75),
                          ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 108,
            child: _onboardingProfiles.isEmpty
                ? _buildEmptyProfileCard(cs)
                : ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: _onboardingProfiles.length + 1,
                    separatorBuilder: (_, _) => const SizedBox(width: 10),
                    itemBuilder: (context, index) {
                      if (index == _onboardingProfiles.length) {
                        return _buildAddProfileTile(cs);
                      }
                      return _buildProfileTile(cs, _onboardingProfiles[index]);
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyProfileCard(ColorScheme cs) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _promptSaveProfile,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: cs.surface.withValues(alpha: 0.45),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: cs.primary.withValues(alpha: 0.25),
              width: 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [cs.primary.withValues(alpha: 0.2), cs.primary.withValues(alpha: 0.08)],
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.bookmark_add_outlined, size: 20, color: cs.primary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Create a profile',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    Text(
                      'Store WiFi, server URL, and baud rate',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75),
                          ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: cs.onSurfaceVariant.withValues(alpha: 0.5)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAddProfileTile(ColorScheme cs) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _promptSaveProfile,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: 88,
          decoration: BoxDecoration(
            color: cs.surface.withValues(alpha: 0.35),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: cs.outline.withValues(alpha: 0.35), width: 1),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.add_rounded, size: 22, color: cs.primary),
              const SizedBox(height: 4),
              Text(
                'New',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: cs.primary,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProfileTile(ColorScheme cs, OnboardingProfile profile) {
    final active = _selectedProfileId == profile.id;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => _selectProfile(profile),
        borderRadius: BorderRadius.circular(14),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          width: 168,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            gradient: active
                ? LinearGradient(
                    colors: [
                      cs.primary.withValues(alpha: 0.18),
                      cs.primary.withValues(alpha: 0.06),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  )
                : null,
            color: active ? null : cs.surface.withValues(alpha: 0.45),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: active ? cs.primary.withValues(alpha: 0.45) : cs.outline.withValues(alpha: 0.25),
              width: active ? 1.2 : 0.5,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.wifi_rounded,
                    size: 14,
                    color: active ? cs.primary : cs.onSurfaceVariant,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      profile.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: active ? cs.onSurface : cs.onSurface.withValues(alpha: 0.9),
                          ),
                    ),
                  ),
                  _buildProfileMenu(cs, profile),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                profile.ssid,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: cs.onSurfaceVariant.withValues(alpha: 0.85),
                      fontSize: 11,
                    ),
              ),
              const Spacer(),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      _shortUrl(profile.serverUrl),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: cs.onSurfaceVariant.withValues(alpha: 0.65),
                            fontSize: 10,
                            fontFamily: 'monospace',
                          ),
                    ),
                  ),
                  if (profile.baudRate != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: (active ? cs.primary : cs.onSurfaceVariant).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        '${profile.baudRate}',
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w600,
                          color: active ? cs.primary : cs.onSurfaceVariant,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProfileMenu(ColorScheme cs, OnboardingProfile profile) {
    return SizedBox(
      width: 28,
      height: 28,
      child: PopupMenuButton<String>(
        padding: EdgeInsets.zero,
        iconSize: 18,
        icon: Icon(Icons.more_horiz_rounded, size: 18, color: cs.onSurfaceVariant.withValues(alpha: 0.7)),
        color: cs.surfaceContainerHigh,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        onSelected: (action) {
          if (action == 'rename') {
            _promptRenameProfile(profile);
          } else if (action == 'delete') {
            _confirmDeleteProfile(profile);
          }
        },
        itemBuilder: (_) => [
          const PopupMenuItem(value: 'rename', child: Text('Rename')),
          PopupMenuItem(
            value: 'delete',
            child: Text('Delete', style: TextStyle(color: cs.error)),
          ),
        ],
      ),
    );
  }

  Widget _buildProfileDirtyBanner(ColorScheme cs) {
    final hasSelection = _selectedProfile != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: cs.tertiaryContainer.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.tertiary.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          Icon(Icons.edit_note_rounded, size: 18, color: cs.tertiary),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              hasSelection ? 'Unsaved changes' : 'Unsaved configuration',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
            ),
          ),
          TextButton(
            onPressed: hasSelection ? _updateCurrentProfile : _promptSaveProfile,
            style: TextButton.styleFrom(
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.symmetric(horizontal: 10),
            ),
            child: Text(hasSelection ? 'Update' : 'Save'),
          ),
        ],
      ),
    );
  }

  Widget _buildFormGroupLabel(ColorScheme cs, String label) {
    return Text(
      label.toUpperCase(),
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: cs.onSurfaceVariant.withValues(alpha: 0.55),
            letterSpacing: 0.8,
            fontWeight: FontWeight.w600,
          ),
    );
  }

  Future<void> _promptRenameProfile(OnboardingProfile profile) async {
    final nameCtrl = TextEditingController(text: profile.name);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        final cs = Theme.of(ctx).colorScheme;
        return AlertDialog(
          backgroundColor: cs.surfaceContainerHigh,
          title: const Text('Rename profile'),
          content: TextField(
            controller: nameCtrl,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Profile name'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
          ],
        );
      },
    );
    if (saved != true || !mounted) return;
    final name = nameCtrl.text.trim();
    nameCtrl.dispose();
    if (name.isEmpty) return;

    final updated = profile.copyWith(name: name, updatedAt: DateTime.now());
    await _storage.saveOnboardingProfile(updated);
    await _loadOnboardingProfiles(selectId: updated.id);
    if (mounted) AppToast.success(context, 'Profile renamed');
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

  Widget _buildOnboardingProfileCard(ColorScheme cs) {
    final steps = _onboardingProfiler.steps.where((s) => s.status != OnboardingStepStatus.pending).toList();
    final maxMs = steps.fold<int>(0, (max, s) {
      final ms = s.durationMs ?? 0;
      return ms > max ? ms : max;
    }).clamp(1, 999999);

    final headerColor = _onboardingProfiler.hasFailed
        ? cs.tertiary
        : _onboardingProfiler.isRunning
            ? cs.primary
            : cs.secondary;

    return _buildGlassCard(cs, [
      Row(
        children: [
          Icon(Icons.speed_rounded, size: 16, color: headerColor),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _onboardingProfiler.isRunning
                  ? 'Profiling onboarding...'
                  : _onboardingProfiler.hasFailed
                      ? 'Onboarding failed'
                      : 'Onboarding complete',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          Text(
            '${_onboardingProfiler.totalMs} ms',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant,
                  fontFamily: 'monospace',
                ),
          ),
        ],
      ),
      if (steps.isNotEmpty) ...[
        const SizedBox(height: 14),
        ...steps.map((step) => _buildProfileStepRow(cs, step, maxMs)),
      ],
    ]);
  }

  Widget _buildProfileStepRow(ColorScheme cs, OnboardingStepRecord step, int maxMs) {
    final (Color color, IconData icon) = switch (step.status) {
      OnboardingStepStatus.running => (cs.primary, Icons.hourglass_top_rounded),
      OnboardingStepStatus.done => (cs.secondary, Icons.check_rounded),
      OnboardingStepStatus.failed => (cs.tertiary, Icons.close_rounded),
      OnboardingStepStatus.pending => (cs.onSurfaceVariant, Icons.circle_outlined),
    };
    final ms = step.durationMs ?? (_onboardingProfiler.isRunning && step.status == OnboardingStepStatus.running
        ? DateTime.now().difference(step.startedAt ?? DateTime.now()).inMilliseconds
        : 0);
    final barWidth = maxMs > 0 ? (ms / maxMs).clamp(0.05, 1.0) : 0.05;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  step.label,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.onSurface),
                ),
              ),
              Text(
                step.status == OnboardingStepStatus.running ? '...' : '${ms}ms',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: cs.onSurfaceVariant,
                      fontFamily: 'monospace',
                      fontSize: 10,
                    ),
              ),
            ],
          ),
          if (step.note != null && step.note!.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              step.note!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                    fontSize: 10,
                  ),
            ),
          ],
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: step.status == OnboardingStepStatus.pending ? 0 : barWidth,
              minHeight: 4,
              backgroundColor: cs.outline.withValues(alpha: 0.15),
              color: color.withValues(alpha: 0.8),
            ),
          ),
        ],
      ),
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
