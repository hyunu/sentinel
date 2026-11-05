import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:http/http.dart' as http;
import '../ble/ble_scanner.dart';
import '../models/board_status.dart';
import '../models/onboarding_profile.dart';
import '../models/viz_profile.dart';
import '../services/board_presence.dart';
import '../services/onboarding_profiler.dart';
import '../services/protocol_parser.dart';
import '../services/storage_service.dart';
import '../widgets/app_toast.dart';
import '../widgets/live_chart.dart';
import 'live_chart_fullscreen.dart';

const String kTemperatureProtocolId = 'temperature-telemetry-v1';
const String kLcpMonitoringV2Id = 'lcp-monitoring-v2';
const String kDefaultServerUrl = 'http://116.39.187.5:50000';

bool _isPreferredLcpVizProfile(VizProfile profile) {
  final name = profile.name.trim().toLowerCase();
  return name.contains('lcp') &&
      (name.contains('단축') ||
          name.contains('단순') ||
          name.contains('short'));
}

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
  final Map<String, dynamic>? parseRules;
  _Protocol(this.id, this.name, this.version, this.fields, this.parseRules);

  bool get hasParseRules {
    final rules = parseRules;
    return rules != null &&
        rules['fields'] is List &&
        (rules['fields'] as List).isNotEmpty;
  }

  factory _Protocol.fromJson(Map<String, dynamic> j) {
    final fieldsRaw = j['fields'];
    final fields = fieldsRaw is List
        ? fieldsRaw
              .map((f) => _ProtocolField.fromJson(f as Map<String, dynamic>))
              .toList()
        : <_ProtocolField>[];
    final rulesRaw = j['parse_rules'];
    final parseRules = rulesRaw is Map
        ? Map<String, dynamic>.from(rulesRaw)
        : null;
    return _Protocol(
      j['id']?.toString() ?? '',
      j['name']?.toString() ?? '',
      j['version']?.toString() ?? '',
      fields,
      parseRules,
    );
  }
}

class _DeviceLogEntry {
  final DateTime at;
  final String text;
  final bool fromBoard;
  const _DeviceLogEntry(this.at, this.text, {this.fromBoard = false});
}

class _UartPacket {
  final DateTime receivedAt;
  final String hex;
  const _UartPacket(this.receivedAt, this.hex);
}

class _LiveSample {
  final DateTime at;
  final Map<String, double> values;
  const _LiveSample(this.at, this.values);
}

const int _maxLiveSamples = 1800;
const int _maxChartSeries = 12;

class DeviceScreen extends StatefulWidget {
  final BluetoothDevice device;
  final AdvertisementData? advertisementData;
  const DeviceScreen({super.key, required this.device, this.advertisementData});

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  final BleScanner _scanner = BleScanner();
  final StorageService _storage = StorageService();
  final OnboardingProfiler _onboardingProfiler = OnboardingProfiler();
  final _ssidCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _baudCtrl = TextEditingController();
  final _urlCtrl = TextEditingController();

  bool _connected = false;
  bool _connecting = false;
  bool _boardWifi = false;
  bool _boardServer = false;
  String? _wifiMac;
  bool _wifiConfigured = false;
  bool _sendingWifi = false;
  List<_UartPacket> _uartLogs = [];
  List<_Protocol> _protocols = [];
  String? _selectedProtoId;
  String? _boardProtoId;
  String? _boardId;
  List<VizProfile> _vizProfiles = [];
  String? _selectedVizProfileId;
  String? _vizProfileError;
  bool _vizProfilesLoading = false;
  final Set<String> _selectedChartItemIds = {};
  int _chartWindowSeconds = 60;
  bool _chartFollow = true;
  int _chartFollowResetToken = 0;
  bool _liveFullscreen = false;
  bool _orientationFullscreenArmed = false;
  final List<_LiveSample> _liveSamples = [];
  int _liveParsedFrames = 0;
  int _liveParseErrors = 0;
  Timer? _liveUiFlushTimer;
  Timer? _presenceTimer;
  bool _liveUiDirty = false;
  ProtocolParser? _cachedParser;
  String? _cachedParserKey;
  StreamSubscription? _uartSub;
  StreamSubscription? _connSub;
  StreamSubscription<String>? _logSub;
  final List<_DeviceLogEntry> _deviceLogs = [];
  final ScrollController _logScrollCtrl = ScrollController();
  String _logRxBuffer = '';
  String _uartRxBuffer = '';
  bool _scanningUart = false;
  List<OnboardingProfile> _onboardingProfiles = [];
  String? _selectedProfileId;

  late TabController _tabCtrl;

  String get _baseUrl {
    final raw = _urlCtrl.text.trim();
    return StorageService.normalizeServerUrl(
      raw.isEmpty ? kDefaultServerUrl : raw,
    );
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final adData = widget.advertisementData;
    if (adData != null) {
      final state = BleScanner.parseStateFromAdData(adData);
      _boardWifi =
          state == SentinelBleState.registering ||
          state == SentinelBleState.online;
      _boardServer = state == SentinelBleState.online;
    }
    _tabCtrl = TabController(length: 3, vsync: this);
    _onboardingProfiler.addListener(_onProfilerUpdated);
    for (final c in [_ssidCtrl, _passCtrl, _baudCtrl, _urlCtrl]) {
      c.addListener(_onFieldChanged);
    }
    _loadSaved();
    _connect();
    _presenceTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (mounted && _connected) {
        _syncBoardFromServer(loadProfiles: false);
      }
    });
  }

  @override
  void didChangeMetrics() {
    super.didChangeMetrics();
    if (!mounted) return;
    final views = WidgetsBinding.instance.platformDispatcher.views;
    if (views.isEmpty) return;
    final view = views.first;
    final logical = view.physicalSize / view.devicePixelRatio;
    final isLandscape = logical.width > logical.height;
    final canAnalyze =
        _selectedVizProfile != null &&
        (_scanningUart || _liveSamples.isNotEmpty);

    if (isLandscape && canAnalyze && !_liveFullscreen) {
      _enterLiveFullscreen(fromOrientation: true);
    } else if (!isLandscape &&
        _liveFullscreen &&
        _orientationFullscreenArmed) {
      _exitLiveFullscreen();
    }
  }

  void _onFieldChanged() {
    if (mounted) setState(() {});
  }

  void _onProfilerUpdated() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (_liveFullscreen) {
      LiveChartFullscreen.exitImmersive();
    }
    _onboardingProfiler.removeListener(_onProfilerUpdated);
    for (final c in [_ssidCtrl, _passCtrl, _baudCtrl, _urlCtrl]) {
      c.removeListener(_onFieldChanged);
    }
    _liveUiFlushTimer?.cancel();
    _presenceTimer?.cancel();
    _uartSub?.cancel();
    _connSub?.cancel();
    _logSub?.cancel();
    _logScrollCtrl.dispose();
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

  Future<void> _enterLiveFullscreen({bool fromOrientation = false}) async {
    if (_liveFullscreen || _selectedVizProfile == null) return;
    _orientationFullscreenArmed = fromOrientation;
    setState(() => _liveFullscreen = true);
    // Button expand locks landscape; rotation-triggered keeps free rotation
    // so returning to portrait can exit automatically.
    await LiveChartFullscreen.enterImmersive(lockLandscape: !fromOrientation);
  }

  Future<void> _exitLiveFullscreen() async {
    if (!_liveFullscreen) return;
    _orientationFullscreenArmed = false;
    setState(() => _liveFullscreen = false);
    await LiveChartFullscreen.exitImmersive();
  }

  void _setChartWindowSeconds(int seconds) {
    setState(() {
      _chartWindowSeconds = seconds;
      _chartFollow = true;
      _chartFollowResetToken++;
    });
  }

  double? _latestFieldValue(String fieldName) {
    if (_liveSamples.isEmpty || fieldName.isEmpty) return null;
    return _liveSamples.last.values[fieldName];
  }

  Future<void> _loadSaved() async {
    await _loadOnboardingProfiles();
    if (_onboardingProfiles.isEmpty) {
      _ssidCtrl.text = 'hyunu_2.4Ghz';
      _passCtrl.text = 'gusdn1006';
      _baudCtrl.text = '19200';
      _urlCtrl.text = kDefaultServerUrl;
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
    _urlCtrl.text = StorageService.normalizeServerUrl(profile.serverUrl);
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
        StorageService.normalizeServerUrl(selected.serverUrl) !=
            StorageService.normalizeServerUrl(url) ||
        selected.baudRate != baud;
  }

  String _compactBleId(String id) {
    if (id.length <= 17) return id;
    return '${id.substring(0, 8)}…${id.substring(id.length - 4)}';
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
      serverUrl: StorageService.normalizeServerUrl(_urlCtrl.text),
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
    if (mounted) {
      AppToast.success(context, 'Profile "${selected.name}" updated');
    }
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
      AppToast.error(
        context,
        'Enter a WiFi SSID before saving a profile.',
        persistent: false,
      );
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
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Save'),
            ),
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
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _storage.deleteOnboardingProfile(profile.id);
    await _loadOnboardingProfiles();
    if (mounted) AppToast.info(context, 'Profile deleted');
  }

  void _addLog(String text, {bool fromBoard = false}) {
    final line = text.replaceAll('\r', '').trimRight();
    if (line.isEmpty || !mounted) return;
    setState(() {
      _deviceLogs.add(
        _DeviceLogEntry(DateTime.now(), line, fromBoard: fromBoard),
      );
      if (_deviceLogs.length > 1000) {
        _deviceLogs.removeRange(0, _deviceLogs.length - 1000);
      }
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_logScrollCtrl.hasClients) {
        _logScrollCtrl.animateTo(
          _logScrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 120),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _onBoardLogChunk(String chunk) {
    _logRxBuffer += chunk;
    while (true) {
      final newline = _logRxBuffer.indexOf('\n');
      if (newline < 0) break;
      final line = _logRxBuffer.substring(0, newline);
      _logRxBuffer = _logRxBuffer.substring(newline + 1);
      _addLog(line, fromBoard: true);
      _updateBoardFlagsFromLog(line);
    }
    // Guard against a malformed peer that never sends a newline.
    if (_logRxBuffer.length > 4096) {
      _logRxBuffer = _logRxBuffer.substring(_logRxBuffer.length - 2048);
    }
  }

  void _updateBoardFlagsFromLog(String line) {
    final upper = line.toUpperCase();
    bool? wifi;
    bool? server;

    if (line.contains('[WiFi] Connecting') ||
        line.contains('Auto-connect to stored network')) {
      // Replayed history must not clear a link the live advertisement
      // already reported. Only an explicit failure does that.
      if (!_boardWifi && !_boardServer) {
        wifi = false;
        server = false;
      }
    }
    if (line.contains('[WiFi] Connected') ||
        upper.contains('EVENT:WIFI_CONNECTED')) {
      wifi = true;
    }
    if (line.contains('Connection timed out') ||
        upper.contains('WIFI_FAILED')) {
      wifi = false;
      server = false;
    }
    if (line.contains('Heartbeat result code: 200') ||
        upper.contains('EVENT:HEARTBEAT_OK')) {
      wifi = true;
      server = true;
    }
    if (line.contains('Heartbeat result code:') &&
        !line.contains('Heartbeat result code: 200')) {
      server = false;
    }
    if (upper.contains('HEARTBEAT_FAILED') ||
        line.contains('Heartbeat: all attempts failed')) {
      server = false;
    }
    if (line.contains('Board registration cleared') ||
        line.contains('Server deleted this board') ||
        upper.contains('BOARD_DELETED')) {
      wifi = false;
      server = false;
    }

    if (!mounted || (wifi == null && server == null)) return;
    setState(() {
      if (wifi != null) _boardWifi = wifi;
      if (server != null) _boardServer = server;
    });
  }

  Future<void> _loadWifiMac() async {
    try {
      final mac = await _scanner.readWifiMac(widget.device);
      final normalized = mac?.trim();
      if (!mounted ||
          normalized == null ||
          normalized.isEmpty ||
          RegExp(r'^[0:]+$').hasMatch(normalized)) {
        return;
      }
      setState(() => _wifiMac = normalized.toUpperCase());
    } catch (_) {
      // Older firmware may not expose the WiFi MAC characteristic.
    }
  }

  Future<void> _startBoardLogStream() async {
    await _logSub?.cancel();
    _logSub = null;
    _logRxBuffer = '';
    try {
      final stream = await _scanner.subscribeToDeviceLogs(widget.device);
      _logSub = stream.listen(
        _onBoardLogChunk,
        onError: (Object error) => _addLog('Board log stream error: $error'),
      );
      _addLog('Board log stream connected.');
      try {
        await _scanner.requestLogHistory(widget.device);
      } catch (e) {
        _addLog('Could not request log history: $e');
      }
    } catch (e) {
      _addLog('Board log stream unavailable: $e');
    }
  }

  void _applyAdvertisedLinkState() {
    final adData = widget.advertisementData;
    if (adData == null) return;
    final state = BleScanner.parseStateFromAdData(adData);
    final wifi =
        state == SentinelBleState.registering ||
        state == SentinelBleState.online;
    final server = state == SentinelBleState.online;
    if (!wifi && !server) return;
    setState(() {
      if (wifi) _boardWifi = true;
      if (server) _boardServer = true;
    });
  }

  Future<void> _connect() async {
    _addLog('Connecting to ${widget.device.remoteId.str}...');
    setState(() => _connecting = true);
    _applyAdvertisedLinkState();
    Object? lastError;
    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
        await widget.device.disconnect().timeout(const Duration(seconds: 2));
      } catch (_) {}
      try {
        await widget.device.connect(timeout: const Duration(seconds: 8));
        await widget.device.connectionState
            .firstWhere((s) => s == BluetoothConnectionState.connected)
            .timeout(const Duration(seconds: 4));
        if (mounted) {
          setState(() {
            _connected = true;
            _connecting = false;
          });
        }
        _addLog('BLE connected.');
        break;
      } catch (e) {
        lastError = e;
        _addLog('BLE connect attempt $attempt/3 failed: $e');
        if (attempt < 3) await Future.delayed(const Duration(seconds: 1));
      }
    }
    if (!_connected) {
      if (mounted) {
        setState(() => _connecting = false);
        _addLog('BLE connection failed after 3 attempts.');
        _showError('Could not connect to the device after 3 attempts.');
      }
      debugPrint('BLE connection failed: $lastError');
      return;
    }

    try {
      await widget.device.requestMtu(512);
    } catch (_) {}

    _scanner.clearCache();
    await _startBoardLogStream();
    _applyAdvertisedLinkState();
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted && _connected) _applyAdvertisedLinkState();
    });
    await _loadWifiMac();

    await _connSub?.cancel();
    _scanner.clearCache();
    _connSub = widget.device.connectionState.listen((s) {
      if (mounted) {
        final connected = s == BluetoothConnectionState.connected;
        if (!connected) {
          _stopUartStream();
        }
        setState(() {
          _connected = connected;
          if (!_connected) {
            _connecting = false;
            _boardWifi = false;
            _boardServer = false;
          }
        });
        _addLog('BLE state: ${s.name}');
      }
    });

    _loadProtocols();
  }

  Future<void> _loadProtocols() async {
    try {
      final base = _baseUrl;
      final res = await http.get(Uri.parse('$base/api/v1/protocols'));
      if (res.statusCode == 200) {
        final list = json.decode(res.body) as List;
        if (mounted) {
          setState(() {
            _protocols = list
                .map((p) => _Protocol.fromJson(p as Map<String, dynamic>))
                .toList();
            final lcpV2 = _protocols.where((p) => p.id == kLcpMonitoringV2Id);
            if (lcpV2.isNotEmpty) {
              _selectedProtoId = kLcpMonitoringV2Id;
            } else if (_selectedProtoId == null || _selectedProtoId!.isEmpty) {
              _selectedProtoId =
                  _protocols.isNotEmpty ? _protocols.first.id : null;
            }
            _cachedParser = null;
            _cachedParserKey = null;
          });
        }
      }
    } catch (_) {}
    await _syncBoardFromServer();
    if (_selectedVizProfileId == null) {
      await _loadVizProfiles();
    }
  }

  Future<void> _syncBoardFromServer({bool loadProfiles = true}) async {
    try {
      final base = _baseUrl;
      final bleMac = widget.device.remoteId.str;
      final wifiNorm = _wifiMac?.replaceAll(':', '').toLowerCase();
      final adv = widget.advertisementData;
      final advUid = adv == null ? null : BleScanner.parseUidFromAdData(adv);
      final res = await http
          .get(Uri.parse('$base/api/v1/boards'))
          .timeout(const Duration(seconds: 5));
      if (res.statusCode != 200 || !mounted) return;

      for (final raw in json.decode(res.body) as List) {
        if (raw is! Map) continue;
        final boardBle = raw['mac_address']?.toString() ?? '';
        final boardWifi = raw['wifi_mac']?.toString() ?? '';
        final boardWifiNorm = boardWifi.replaceAll(':', '').toLowerCase();
        final boardUid = raw['uid']?.toString();
        final bleMatch = boardBle.isNotEmpty && boardBle == bleMac;
        final wifiMatch =
            wifiNorm != null &&
            wifiNorm.isNotEmpty &&
            boardWifiNorm.isNotEmpty &&
            boardWifiNorm == wifiNorm;
        final uidMatch =
            advUid != null &&
            advUid.isNotEmpty &&
            boardUid != null &&
            boardUid == advUid;
        if (!bleMatch && !wifiMatch && !uidMatch) continue;
        final protocolId = raw['protocol_id']?.toString();
        final boardId = raw['id']?.toString();
        final heartbeat = DateTime.tryParse(
          raw['last_heartbeat']?.toString() ?? '',
        );
        DateTime? uartAt;
        if (boardId != null && boardId.isNotEmpty) {
          try {
            uartAt = await latestUartAt(base, boardId);
          } catch (_) {}
        }
        final presence = freshestBoardPresence(heartbeat, uartAt);
        final serverFresh = BoardStatusResolver.isRecent(presence);
        if (!mounted) return;
        setState(() {
          _boardId = boardId;
          if (protocolId != null && protocolId.isNotEmpty) {
            _boardProtoId = protocolId;
            _selectedProtoId = protocolId;
          }
          if (serverFresh) {
            _boardWifi = true;
            _boardServer = true;
          } else if (!loadProfiles) {
            _boardServer = false;
          }
        });
        if (loadProfiles) await _loadVizProfiles();
        return;
      }
    } catch (_) {}
  }

  Future<List<VizProfile>> _fetchVizProfiles({String? boardId}) async {
    final uri = boardId == null || boardId.isEmpty
        ? Uri.parse('$_baseUrl/api/v1/viz/profiles')
        : Uri.parse(
            '$_baseUrl/api/v1/viz/profiles?board_id=${Uri.encodeQueryComponent(boardId)}',
          );
    final res = await http.get(uri).timeout(const Duration(seconds: 6));
    if (res.statusCode != 200) {
      throw Exception('HTTP ${res.statusCode}');
    }
    final rawList = json.decode(res.body) as List;
    return rawList
        .whereType<Map>()
        .map((e) => VizProfile.fromJson(Map<String, dynamic>.from(e)))
        .where((p) => p.id.isNotEmpty)
        .toList();
  }

  VizProfile? _pickPreferredVizProfile(
    List<VizProfile> profiles, {
    String? savedId,
  }) {
    for (final profile in profiles) {
      if (_isPreferredLcpVizProfile(profile)) return profile;
    }
    if (savedId != null) {
      for (final profile in profiles) {
        if (profile.id == savedId) return profile;
      }
    }
    return profiles.isNotEmpty ? profiles.first : null;
  }

  Future<void> _loadVizProfiles() async {
    final boardId = _boardId;
    if (mounted) {
      setState(() {
        _vizProfilesLoading = true;
        _vizProfileError = null;
      });
    }
    try {
      var profiles = boardId == null || boardId.isEmpty
          ? await _fetchVizProfiles()
          : await _fetchVizProfiles(boardId: boardId);

      // Always try to include / prefer "LCP (단축|단순)" even if it belongs to
      // another board_id on the server.
      final hasPreferred = profiles.any(_isPreferredLcpVizProfile);
      if (!hasPreferred) {
        final all = await _fetchVizProfiles();
        for (final profile in all) {
          if (_isPreferredLcpVizProfile(profile) &&
              !profiles.any((p) => p.id == profile.id)) {
            profiles = [profile, ...profiles];
          }
        }
      }

      final savedId = boardId == null
          ? null
          : await _storage.getLastVizProfileId(boardId);
      final selected = _pickPreferredVizProfile(profiles, savedId: savedId);

      if (!mounted) return;
      setState(() {
        _vizProfiles = profiles;
        _vizProfilesLoading = false;
        _vizProfileError = profiles.isEmpty
            ? 'No chart profile is registered for this board.'
            : null;
        _selectedVizProfileId = selected?.id;
        _cachedParser = null;
        _cachedParserKey = null;
        _selectedChartItemIds
          ..clear()
          ..addAll(_defaultChartItemIds(selected));
      });
      if (selected != null && boardId != null) {
        await _storage.setLastVizProfileId(boardId, selected.id);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _vizProfilesLoading = false;
        _vizProfileError = 'Could not load profiles from the server.';
      });
      debugPrint('load viz profiles failed: $e');
    }
  }

  VizProfile? get _selectedVizProfile {
    final id = _selectedVizProfileId;
    if (id == null) return null;
    for (final profile in _vizProfiles) {
      if (profile.id == id) return profile;
    }
    return null;
  }

  Set<String> _defaultChartItemIds(VizProfile? profile) {
    if (profile == null) return <String>{};
    final candidates = profile.items
        .where((item) => item.visible && _itemMatchesBoard(item))
        .toList();
    final fallback = candidates.isEmpty
        ? profile.items.where(_itemMatchesBoard).toList()
        : candidates;
    return fallback
        .take(_maxChartSeries)
        .map((item) => item.id)
        .toSet();
  }

  bool _itemMatchesBoard(VizProfileItem item) {
    if (item.protocolId.isEmpty) return true;
    // Live parsing is forced to LCP monitoring v2 — keep those fields selectable
    // even when the board record still points at an older protocol id.
    if (item.protocolId == kLcpMonitoringV2Id) return true;
    final boardProtocol = _boardProtoId ?? _selectedProtoId;
    if (boardProtocol == null || boardProtocol.isEmpty) return true;
    return item.protocolId == boardProtocol;
  }

  Future<void> _selectVizProfile(String? id) async {
    if (id == null) return;
    VizProfile? selected;
    for (final profile in _vizProfiles) {
      if (profile.id == id) {
        selected = profile;
        break;
      }
    }
    if (selected == null) return;
    setState(() {
      _selectedVizProfileId = selected!.id;
      _selectedChartItemIds
        ..clear()
        ..addAll(_defaultChartItemIds(selected));
    });
    final boardId = _boardId;
    if (boardId != null) {
      await _storage.setLastVizProfileId(boardId, selected.id);
    }
  }

  /// Live UART chart always parses with LCP Monitoring v2 when available.
  String? _resolveLiveProtocolId() {
    for (final protocol in _protocols) {
      if (protocol.id == kLcpMonitoringV2Id && protocol.hasParseRules) {
        return kLcpMonitoringV2Id;
      }
    }
    final profile = _selectedVizProfile;
    if (profile != null) {
      for (final item in profile.items) {
        if (item.protocolId.isNotEmpty) return item.protocolId;
      }
    }
    if (_boardProtoId != null && _boardProtoId!.isNotEmpty) {
      return _boardProtoId;
    }
    final selected = _selectedProtoId;
    if (selected != null &&
        selected.isNotEmpty &&
        selected != kTemperatureProtocolId) {
      return selected;
    }
    for (final protocol in _protocols) {
      if (protocol.hasParseRules && protocol.id != kTemperatureProtocolId) {
        return protocol.id;
      }
    }
    return selected;
  }

  ProtocolParser? get _liveParser {
    final protocolId = _resolveLiveProtocolId();
    if (protocolId == null || protocolId.isEmpty) return null;
    if (_cachedParserKey == protocolId && _cachedParser != null) {
      return _cachedParser;
    }
    for (final protocol in _protocols) {
      if (protocol.id != protocolId) continue;
      if (!protocol.hasParseRules) return null;
      try {
        _cachedParser = ProtocolParser.fromParseRules(protocol.parseRules);
        _cachedParserKey = protocolId;
        return _cachedParser;
      } catch (e) {
        debugPrint('protocol parser init failed: $e');
        return null;
      }
    }
    return null;
  }

  /// LCP monitoring frames are AA [LEN] CA …. Other FIDs on the wire are not
  /// chart errors — skip them quietly.
  int? _peekFrameFid(String hex) {
    final compact = hex.replaceAll(RegExp(r'\s+'), '');
    if (compact.length < 6) return null;
    return int.tryParse(compact.substring(4, 6), radix: 16);
  }

  bool _isSkippableLiveFrame(String hex, Object error) {
    final msg = error.toString();
    if (msg.contains('validation failed: fid')) return true;
    final fid = _peekFrameFid(hex);
    if (fid != null && fid != 0xCA) return true;
    return false;
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
        if (!hbUtc.isBefore(
          since.toUtc().subtract(const Duration(seconds: 5)),
        )) {
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
    bool Function()? shouldAbort,
    DateTime? newerThan,
    Duration timeout = const Duration(seconds: 40),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      if (heartbeatOk.isCompleted) return;
      if (shouldAbort?.call() == true) {
        throw StateError('wifi_failed');
      }
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
      throw TimeoutException(
        'heartbeat not received within ${timeout.inSeconds}s',
      );
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

  String? _findExistingUidForMac(
    List boards,
    String bleMac, {
    String? wifiMac,
  }) {
    String? bestUid;
    int? bestNum;
    final wifiNorm = wifiMac?.replaceAll(':', '').toLowerCase();
    for (final raw in boards) {
      if (raw is! Map) continue;
      final boardBle = raw['mac_address']?.toString() ?? '';
      final boardWifi = raw['wifi_mac']?.toString() ?? '';
      final boardWifiNorm = boardWifi.replaceAll(':', '').toLowerCase();
      final bleMatch = boardBle.isNotEmpty && boardBle == bleMac;
      final wifiMatch =
          wifiNorm != null &&
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

  Future<String?> _claimUid(
    String baseUrl,
    String bleMac, {
    String? wifiMac,
  }) async {
    Object? lastError;
    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
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
        lastError = 'HTTP ${claimRes.statusCode}';
      } catch (e) {
        lastError = e;
      }
      if (attempt < 3) await Future.delayed(const Duration(seconds: 1));
    }
    throw Exception('Claim failed: $lastError');
  }

  Future<void> _sendWifi() async {
    final ssid = _ssidCtrl.text.trim();
    final pass = _passCtrl.text.trim();
    if (ssid.isEmpty) return;

    _onboardingProfiler.begin();
    setState(() {
      _sendingWifi = true;
      _boardWifi = false;
      _boardServer = false;
    });
    try {
      final baud = int.tryParse(_baudCtrl.text.trim());
      final baseUrl = _baseUrl;
      _addLog('Onboarding started: $baseUrl');

      _onboardingProfiler.startStep('server_reachable');
      Object? pingError;
      var serverReachable = false;
      for (var attempt = 1; attempt <= 3; attempt++) {
        try {
          final pingRes = await http
              .get(Uri.parse('$baseUrl/api/v1/protocols'))
              .timeout(const Duration(seconds: 4));
          if (pingRes.statusCode >= 200 && pingRes.statusCode < 400) {
            serverReachable = true;
            break;
          }
          pingError = 'HTTP ${pingRes.statusCode}';
        } catch (e) {
          pingError = e;
        }
        if (attempt < 3) await Future.delayed(const Duration(seconds: 1));
      }
      if (!serverReachable) {
        _onboardingProfiler.finishFailure(
          'server_reachable',
          note: '$pingError',
        );
        if (mounted) {
          _showOnboardingFailure(
            'Cannot reach the server. Check the server URL.',
          );
        }
        return;
      }
      _onboardingProfiler.completeStep('server_reachable');

      final bleMac = widget.device.remoteId.str;
      String? wifiMac;
      try {
        wifiMac = await _scanner.readWifiMac(widget.device);
      } catch (_) {}
      if (wifiMac != null && RegExp(r'^[0:]+$').hasMatch(wifiMac)) {
        wifiMac = null; // ignore all-zero MAC from older firmware
      }

      String? claimedUid;
      DateTime? heartbeatBaseline;

      _onboardingProfiler.startStep('uid_claimed');
      try {
        final boardsRes = await http
            .get(Uri.parse('$baseUrl/api/v1/boards'))
            .timeout(const Duration(seconds: 5));
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

      Completer<void>? heartbeatOk;
      var configSent = false;
      var wifiFailed = false;
      StreamSubscription<String>? logSub;

      _onboardingProfiler.startStep('ble_subscribed');
      try {
        final logStream = await _scanner.subscribeToLogs(widget.device);
        _onboardingProfiler.completeStep('ble_subscribed');
        logSub = logStream.listen((msg) {
          debugPrint('[BLE LOG] $msg');
          _updateBoardFlagsFromLog(msg);
          _onboardingProfiler.markBleEvent(msg);
          if (msg.contains('EVENT:WIFI_FAILED')) wifiFailed = true;
          if (!configSent) return;
          if (msg.contains('EVENT:HEARTBEAT_OK') &&
              heartbeatOk != null &&
              !heartbeatOk.isCompleted) {
            heartbeatOk.complete();
          }
        });
      } catch (e) {
        _onboardingProfiler.finishFailure('ble_subscribed', note: '$e');
        debugPrint('BLE log subscribe failed: $e');
      }

      _onboardingProfiler.startStep('board_ready');
      Object? onboardingError;
      var boardReady = false;
      for (var attempt = 1; attempt <= 3; attempt++) {
        final currentHeartbeat = Completer<void>();
        heartbeatOk = currentHeartbeat;
        wifiFailed = false;
        configSent = false;
        try {
          _onboardingProfiler.startStep(
            'config_sent',
            note: 'attempt $attempt/3',
          );
          await _scanner.sendWifiConfig(
            widget.device,
            ssid: ssid,
            password: pass,
            baudRate: baud,
            serverUrl: baseUrl,
            uid: claimedUid,
          );
          configSent = true;
          _onboardingProfiler.completeStep('config_sent', note: claimedUid);
          _addLog('Config sent (attempt $attempt/3): $ssid');
          _addLog('Waiting for board heartbeat...');
          await _waitForBoardReady(
            baseUrl: baseUrl,
            uid: claimedUid,
            since: claimTime,
            newerThan: heartbeatBaseline,
            heartbeatOk: currentHeartbeat,
            shouldAbort: () => wifiFailed,
          );
          boardReady = true;
          break;
        } catch (e) {
          onboardingError = e;
          _addLog('Onboarding attempt $attempt/3 failed: $e');
          if (attempt < 3) {
            try {
              await _connect();
            } catch (_) {}
            await Future.delayed(const Duration(seconds: 1));
          }
        }
      }
      if (!boardReady)
        throw onboardingError ?? TimeoutException('board not ready');
      _onboardingProfiler.completeStep('board_ready');
      await logSub?.cancel();

      _onboardingProfiler.startStep('registered');
      String? uid;
      Object? regError;
      for (var attempt = 1; attempt <= 3; attempt++) {
        try {
          final regRes = await http
              .post(
                Uri.parse('$baseUrl/api/v1/boards/register'),
                headers: {'Content-Type': 'application/json'},
                body: json.encode({
                  'uid': claimedUid,
                  'mac_address': bleMac,
                  if (wifiMac != null && wifiMac.isNotEmpty)
                    'wifi_mac': wifiMac,
                  if (_selectedProtoId != null && _selectedProtoId!.isNotEmpty)
                    'protocol_id': _selectedProtoId,
                }),
              )
              .timeout(const Duration(seconds: 5));
          if (regRes.statusCode == 201) {
            final regBody = json.decode(regRes.body);
            uid = regBody['uid']?.toString() ?? claimedUid;
            _onboardingProfiler.completeStep('registered', note: uid);
            break;
          }
          regError = 'HTTP ${regRes.statusCode} ${regRes.body}';
        } catch (e) {
          regError = e;
        }
        if (attempt < 3) {
          await Future.delayed(const Duration(seconds: 1));
        }
      }
      if (uid == null) {
        _onboardingProfiler.finishFailure('registered', note: '$regError');
        throw Exception('Server registration failed: $regError');
      }

      await _storage.saveWifiProfile(ssid, pass);
      await _storage.setServerUrl(baseUrl);
      await _persistCurrentProfile();

      _onboardingProfiler.finishSuccess(uid: uid);
      _addLog('Onboarding completed: uid=$uid');

      if (mounted) {
        setState(() => _wifiConfigured = true);
        _scanner.clearCache();
        Navigator.pop(context, uid);
      }
    } catch (e) {
      if (!_onboardingProfiler.hasFailed) {
        _onboardingProfiler.finishFailure('board_ready', note: '$e');
      }
      if (mounted) {
        _showOnboardingFailure(_onboardingErrorMessage(e));
      }
      _addLog('Onboarding failed: $e');
    } finally {
      if (mounted) setState(() => _sendingWifi = false);
    }
  }

  Future<void> _stopUartStream() async {
    await _uartSub?.cancel();
    _uartSub = null;
    _uartRxBuffer = '';
    if (mounted && _scanningUart) {
      setState(() => _scanningUart = false);
    } else {
      _scanningUart = false;
    }
  }

  Future<void> _startUartStream() async {
    if (!_connected) {
      _showError('Connect to the board before starting the live stream.');
      return;
    }
    await _stopUartStream();
    _uartRxBuffer = '';
    try {
      _scanner.clearCache();
      final ch = await _scanner.uartNotifyCharacteristic(widget.device);
      // Listen before enabling notifications (flutter_blue_plus iOS guidance).
      _uartSub = ch.onValueReceived.listen(
        _onUartChunk,
        onError: (Object error) {
          _addLog('UART stream error: $error');
          _stopUartStream();
        },
        onDone: () {
          _addLog('UART stream closed.');
          _stopUartStream();
        },
      );
      widget.device.cancelWhenDisconnected(_uartSub!);
      if (ch.isNotifying) {
        try {
          await ch.setNotifyValue(false);
        } catch (_) {}
      }
      await ch.setNotifyValue(true);
      if (mounted) {
        setState(() => _scanningUart = true);
        _addLog('UART live stream started.');
      }
    } catch (e) {
      await _stopUartStream();
      _addLog('UART stream failed: $e');
      if (mounted) _showError('Failed to start the UART stream: $e');
    }
  }

  void _onUartChunk(List<int> data) {
    if (!mounted) return;
    // The firmware sends ASCII hex terminated by '\n'.
    _uartRxBuffer += String.fromCharCodes(data);

    while (true) {
      final newline = _uartRxBuffer.indexOf('\n');
      if (newline < 0) break;
      final line = _uartRxBuffer
          .substring(0, newline)
          .replaceAll('\r', '')
          .trim()
          .toUpperCase();
      _uartRxBuffer = _uartRxBuffer.substring(newline + 1);

      if (line.isEmpty || line.startsWith('EVENT:')) continue;
      final compact = line.replaceAll(RegExp(r'\s+'), '');
      if (compact.length.isOdd || !RegExp(r'^[0-9A-F]+$').hasMatch(compact)) {
        if (_liveParseErrors < 5) {
          _addLog('UART skipped non-hex line (${line.length} chars)');
        }
        _liveParseErrors++;
        continue;
      }
      _handleLiveFrame(compact);
    }

    if (_uartRxBuffer.length > 16384) {
      _uartRxBuffer = '';
    }
  }

  void _scheduleLiveUiFlush() {
    _liveUiDirty = true;
    if (_liveUiFlushTimer != null) return;
    // Batch chart/status rebuilds so dense UART bursts don't stutter the UI.
    _liveUiFlushTimer = Timer(const Duration(milliseconds: 100), () {
      _liveUiFlushTimer = null;
      if (!mounted || !_liveUiDirty) return;
      _liveUiDirty = false;
      setState(() {});
    });
  }

  void _handleLiveFrame(String hex) {
    final now = DateTime.now();
    final parser = _liveParser;
    Map<String, double>? values;
    var skipped = false;
    if (parser == null) {
      _liveParseErrors++;
      if (_liveParseErrors <= 3) {
        _addLog('UART parse skipped: no protocol parser loaded');
      }
    } else {
      final fid = _peekFrameFid(hex);
      if (fid != null && fid != 0xCA) {
        skipped = true;
      } else {
        try {
          values = parser.parseHex(hex);
        } catch (e) {
          if (_isSkippableLiveFrame(hex, e)) {
            skipped = true;
          } else {
            _liveParseErrors++;
            if (_liveParseErrors <= 5) {
              _addLog(
                'UART parse error (${_resolveLiveProtocolId()}): $e',
              );
            }
          }
        }
      }
    }

    if (!skipped) _liveParsedFrames++;
    if (values != null && values.isNotEmpty) {
      _liveSamples.add(_LiveSample(now, values));
      if (_liveSamples.length > _maxLiveSamples) {
        _liveSamples.removeRange(0, _liveSamples.length - _maxLiveSamples);
      }
    }
    if (!skipped || values != null) {
      _uartLogs.add(_UartPacket(now, _spaceHex(hex)));
      if (_uartLogs.length > 500) {
        _uartLogs = _uartLogs.sublist(_uartLogs.length - 500);
      }
    }
    if (!skipped || values != null) {
      _scheduleLiveUiFlush();
    }
  }

  String _spaceHex(String hex) {
    final buffer = StringBuffer();
    for (var i = 0; i + 1 < hex.length; i += 2) {
      if (buffer.isNotEmpty) buffer.write(' ');
      buffer.write(hex.substring(i, i + 2));
    }
    return buffer.toString();
  }

  List<LiveChartSeries> _buildLiveSeries() {
    final profile = _selectedVizProfile;
    if (profile == null) return const [];

    final result = <LiveChartSeries>[];
    for (final item in profile.items) {
      if (!_selectedChartItemIds.contains(item.id)) continue;
      if (!_itemMatchesBoard(item)) continue;
      final points = <LiveChartPoint>[];
      for (final sample in _liveSamples) {
        final timeMs = sample.at.millisecondsSinceEpoch;
        final value = sample.values[item.fieldName];
        if (value == null) continue;
        points.add(LiveChartPoint(timeMs, value));
      }
      result.add(
        LiveChartSeries(
          id: item.id,
          label: item.shortLabel.isEmpty ? item.label : item.shortLabel,
          unit: item.unit,
          color: item.color,
          rightAxis: item.isRightAxis,
          points: points,
          latest: points.isEmpty ? null : points.last.value,
        ),
      );
    }
    return result;
  }

  void _toggleChartItem(String id) {
    setState(() {
      if (_selectedChartItemIds.contains(id)) {
        if (_selectedChartItemIds.length > 1) {
          _selectedChartItemIds.remove(id);
        }
      } else if (_selectedChartItemIds.length < _maxChartSeries) {
        _selectedChartItemIds.add(id);
      }
    });
  }

  Future<void> _showFieldPicker() async {
    final profile = _selectedVizProfile;
    if (profile == null) return;
    final candidates =
        profile.items.where(_itemMatchesBoard).toList()
          ..sort((a, b) => a.label.compareTo(b.label));
    if (candidates.isEmpty) return;

    final chosen = <String>{..._selectedChartItemIds};
    var query = '';
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surfaceContainerHigh,
      builder: (ctx) {
        final cs = Theme.of(ctx).colorScheme;
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            final filtered = query.trim().isEmpty
                ? candidates
                : candidates.where((item) {
                    final q = query.trim().toLowerCase();
                    return item.label.toLowerCase().contains(q) ||
                        item.shortLabel.toLowerCase().contains(q) ||
                        item.fieldName.toLowerCase().contains(q);
                  }).toList();
            return SafeArea(
              child: SizedBox(
                height: MediaQuery.of(ctx).size.height * 0.72,
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Chart fields',
                              style: Theme.of(ctx).textTheme.titleMedium,
                            ),
                          ),
                          Text(
                            '${chosen.length}/$_maxChartSeries',
                            style: TextStyle(
                              fontSize: 12,
                              color: cs.onSurfaceVariant,
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(ctx),
                            icon: const Icon(Icons.close_rounded),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                      child: TextField(
                        autofocus: true,
                        onChanged: (value) =>
                            setSheetState(() => query = value),
                        decoration: InputDecoration(
                          hintText: 'Search label or field name',
                          prefixIcon: const Icon(Icons.search_rounded, size: 18),
                          isDense: true,
                          filled: true,
                          fillColor: cs.surface.withValues(alpha: 0.55),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 10,
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      child: filtered.isEmpty
                          ? Center(
                              child: Text(
                                'No fields match “$query”',
                                style: TextStyle(
                                  color: cs.onSurfaceVariant.withValues(
                                    alpha: 0.65,
                                  ),
                                ),
                              ),
                            )
                          : ListView.builder(
                              itemCount: filtered.length,
                              itemBuilder: (ctx, index) {
                                final item = filtered[index];
                                final selected = chosen.contains(item.id);
                                final latest =
                                    _latestFieldValue(item.fieldName);
                                final latestText = latest == null
                                    ? '—'
                                    : latest.abs() >= 100
                                        ? latest.toStringAsFixed(0)
                                        : latest.toStringAsFixed(2);
                                return CheckboxListTile(
                                  value: selected,
                                  dense: true,
                                  activeColor: item.color,
                                  title: Text(
                                    item.shortLabel.isEmpty
                                        ? item.label
                                        : item.shortLabel,
                                    style: const TextStyle(fontSize: 13),
                                  ),
                                  subtitle: Text(
                                    '${item.fieldName} · latest $latestText',
                                    style: TextStyle(
                                      fontSize: 10,
                                      fontFamily: 'monospace',
                                      color: cs.onSurfaceVariant.withValues(
                                        alpha: 0.6,
                                      ),
                                    ),
                                  ),
                                  secondary: Container(
                                    width: 8,
                                    height: 8,
                                    decoration: BoxDecoration(
                                      color: item.color,
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                                  onChanged: (value) {
                                    setSheetState(() {
                                      if (value == true) {
                                        if (chosen.length < _maxChartSeries) {
                                          chosen.add(item.id);
                                        }
                                      } else {
                                        chosen.remove(item.id);
                                      }
                                    });
                                  },
                                );
                              },
                            ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                      child: SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: chosen.isEmpty
                              ? null
                              : () => Navigator.pop(ctx),
                          child: const Text('Apply'),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
    if (!mounted || chosen.isEmpty) return;
    setState(() {
      _selectedChartItemIds
        ..clear()
        ..addAll(chosen);
    });
  }

  double _liveRate() {
    final since = DateTime.now()
        .subtract(const Duration(seconds: 5))
        .millisecondsSinceEpoch;
    var count = 0;
    for (final sample in _liveSamples) {
      if (sample.at.millisecondsSinceEpoch >= since) count++;
    }
    return count / 5;
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
    if (msg.contains('Register failed') ||
        msg.contains('Server registration failed')) {
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

  void _showOnboardingFailure(String message) {
    AppToast.action(
      context,
      '$message Open Logs for board details.',
      actionLabel: 'View Logs',
      onAction: () {
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        _tabCtrl.animateTo(2);
      },
    );
  }

  void _onProtocolChanged(String? id) {
    setState(() {
      _selectedProtoId = id;
      _cachedParser = null;
      _cachedParserKey = null;
    });
  }

  String _protocolName(String? id) {
    if (id == null || id.isEmpty) return 'Not assigned';
    for (final p in _protocols) {
      if (p.id == id) return '${p.name} v${p.version}';
    }
    return id;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    if (_liveFullscreen) {
      final profile = _selectedVizProfile;
      return Scaffold(
        body: LiveChartFullscreen(
          title: profile?.name ?? 'Live chart',
          subtitle: _scanningUart ? 'Streaming' : 'Buffer',
          series: _buildLiveSeries(),
          windowSeconds: _chartWindowSeconds,
          follow: _chartFollow,
          followResetToken: _chartFollowResetToken,
          onWindowSecondsChanged: _setChartWindowSeconds,
          onFollowChanged: (follow) {
            if (_chartFollow != follow) {
              setState(() => _chartFollow = follow);
            }
          },
          onOpenFields: _showFieldPicker,
          onClose: _exitLiveFullscreen,
          fieldsLabel:
              'Fields ${_selectedChartItemIds.length}/$_maxChartSeries',
        ),
      );
    }

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
                _buildLogsTab(cs),
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
        border: Border(
          bottom: BorderSide(
            color: cs.outline.withValues(alpha: 0.3),
            width: 0.5,
          ),
        ),
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
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
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
                        'BLE: ${_compactBleId(widget.device.remoteId.str)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant.withValues(alpha: 0.65),
                          fontFamily: 'monospace',
                          fontSize: 9,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'WiFi MAC: ${_wifiMac ?? '—'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant.withValues(alpha: 0.65),
                          fontFamily: 'monospace',
                          fontSize: 9,
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 12),
                  child: _buildConnectionFlags(cs),
                ),
              ],
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _buildConnectionFlags(ColorScheme cs) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildFlagChip(
          cs,
          'BLE',
          _connected,
          'Bluetooth LE connected',
          cs.primary,
        ),
        const SizedBox(width: 4),
        _buildFlagChip(cs, 'AP', _boardWifi, 'WiFi AP connected', cs.secondary),
        const SizedBox(width: 4),
        _buildFlagChip(
          cs,
          'SVR',
          _boardServer,
          'Server heartbeat registered',
          cs.secondary,
        ),
      ],
    );
  }

  Widget _buildFlagChip(
    ColorScheme cs,
    String label,
    bool active,
    String tooltip,
    Color accent,
  ) {
    final color = active ? accent : cs.onSurfaceVariant.withValues(alpha: 0.45);
    return Tooltip(
      message: tooltip,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: active
              ? accent.withValues(alpha: 0.1)
              : cs.onSurfaceVariant.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: active
                ? accent.withValues(alpha: 0.25)
                : cs.outline.withValues(alpha: 0.2),
            width: 0.5,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.3,
            color: color,
          ),
        ),
      ),
    );
  }

  Widget _buildTabs(ColorScheme cs) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: cs.outline.withValues(alpha: 0.2),
            width: 0.5,
          ),
        ),
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
          Tab(text: 'Live'),
          Tab(text: 'Logs'),
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
            _buildTextField(
              cs,
              _passCtrl,
              'WiFi Password',
              Icons.lock_rounded,
              obscure: true,
            ),
            const SizedBox(height: 16),
            _buildFormGroupLabel(cs, 'Device'),
            const SizedBox(height: 8),
            _buildTextField(
              cs,
              _baudCtrl,
              'Baud Rate',
              Icons.speed_rounded,
              placeholder: 'e.g. 115200',
            ),
            const SizedBox(height: 16),
            _buildFormGroupLabel(cs, 'Server'),
            const SizedBox(height: 8),
            _buildTextField(
              cs,
              _urlCtrl,
              'Server URL',
              Icons.dns_rounded,
              placeholder: kDefaultServerUrl,
            ),
            const SizedBox(height: 16),
            _buildFormGroupLabel(cs, 'Protocol'),
            const SizedBox(height: 8),
            if (_boardProtoId != null)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: cs.surface.withValues(alpha: 0.45),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: cs.outline.withValues(alpha: 0.25),
                    width: 0.5,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.lock_outline_rounded,
                      size: 16,
                      color: cs.primary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _protocolName(_boardProtoId),
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                          Text(
                            'Applied at onboarding · temporary override in Data',
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: cs.onSurfaceVariant.withValues(
                                    alpha: 0.6,
                                  ),
                                  fontSize: 10,
                                ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              )
            else if (_protocols.isEmpty)
              Text(
                'Load protocols from the server URL above.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.65),
                ),
              )
            else
              DropdownButtonFormField<String>(
                value: _selectedProtoId,
                decoration: InputDecoration(
                  labelText: 'UART parse protocol',
                  filled: true,
                  fillColor: cs.surface.withValues(alpha: 0.45),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                items: _protocols
                    .map(
                      (p) => DropdownMenuItem(
                        value: p.id,
                        child: Text(
                          '${p.name} v${p.version}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                    .toList(),
                onChanged: _onProtocolChanged,
              ),
            if (_protocols.isEmpty) ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _loadProtocols,
                  icon: const Icon(Icons.refresh_rounded, size: 16),
                  label: const Text('Reload protocols'),
                ),
              ),
            ],
            if (_selectedProtoId != null && _selectedProtoId!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Saved on the server for this board. ESP32 does not need the protocol ID.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.65),
                  height: 1.35,
                ),
              ),
            ],
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
        border: Border.all(
          color: cs.outline.withValues(alpha: 0.25),
          width: 0.5,
        ),
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
                    colors: [
                      cs.primary.withValues(alpha: 0.2),
                      cs.primary.withValues(alpha: 0.08),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.bookmark_add_outlined,
                  size: 20,
                  color: cs.primary,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Create a profile',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
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
              Icon(
                Icons.chevron_right_rounded,
                color: cs.onSurfaceVariant.withValues(alpha: 0.5),
              ),
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
            border: Border.all(
              color: cs.outline.withValues(alpha: 0.35),
              width: 1,
            ),
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
              color: active
                  ? cs.primary.withValues(alpha: 0.45)
                  : cs.outline.withValues(alpha: 0.25),
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
                        color: active
                            ? cs.onSurface
                            : cs.onSurface.withValues(alpha: 0.9),
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
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: (active ? cs.primary : cs.onSurfaceVariant)
                            .withValues(alpha: 0.12),
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
        icon: Icon(
          Icons.more_horiz_rounded,
          size: 18,
          color: cs.onSurfaceVariant.withValues(alpha: 0.7),
        ),
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
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
            ),
          ),
          TextButton(
            onPressed: hasSelection
                ? _updateCurrentProfile
                : _promptSaveProfile,
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
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Save'),
            ),
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
        Text(
          title,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
            color: cs.onSurfaceVariant.withValues(alpha: 0.7),
          ),
        ),
      ],
    );
  }

  Widget _buildOnboardingProfileCard(ColorScheme cs) {
    final steps = _onboardingProfiler.steps
        .where((s) => s.status != OnboardingStepStatus.pending)
        .toList();
    final maxMs = steps
        .fold<int>(0, (max, s) {
          final ms = s.durationMs ?? 0;
          return ms > max ? ms : max;
        })
        .clamp(1, 999999);

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

  Widget _buildProfileStepRow(
    ColorScheme cs,
    OnboardingStepRecord step,
    int maxMs,
  ) {
    final (Color color, IconData icon) = switch (step.status) {
      OnboardingStepStatus.running => (cs.primary, Icons.hourglass_top_rounded),
      OnboardingStepStatus.done => (cs.secondary, Icons.check_rounded),
      OnboardingStepStatus.failed => (cs.tertiary, Icons.close_rounded),
      OnboardingStepStatus.pending => (
        cs.onSurfaceVariant,
        Icons.circle_outlined,
      ),
    };
    final ms =
        step.durationMs ??
        (_onboardingProfiler.isRunning &&
                step.status == OnboardingStepStatus.running
            ? DateTime.now()
                  .difference(step.startedAt ?? DateTime.now())
                  .inMilliseconds
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
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: cs.onSurface),
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
        border: Border.all(
          color: cs.outline.withValues(alpha: 0.3),
          width: 0.5,
        ),
      ),
      child: Column(children: children),
    );
  }

  Widget _buildTextField(
    ColorScheme cs,
    TextEditingController ctrl,
    String label,
    IconData icon, {
    bool obscure = false,
    String? placeholder,
  }) {
    return TextField(
      controller: ctrl,
      obscureText: obscure,
      style: TextStyle(fontSize: 14, color: cs.onSurface),
      decoration: InputDecoration(
        hintText: placeholder ?? label,
        prefixIcon: Icon(
          icon,
          size: 18,
          color: cs.primary.withValues(alpha: 0.6),
        ),
        filled: true,
        fillColor: cs.surface.withValues(alpha: 0.5),
        hintStyle: TextStyle(
          color: cs.onSurfaceVariant.withValues(alpha: 0.4),
          fontSize: 13,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
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
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : Icon(
                _connected ? Icons.send_rounded : Icons.bluetooth_disabled,
                size: 18,
              ),
        label: Text(
          _sendingWifi
              ? 'Sending...'
              : _connected
              ? (_wifiConfigured
                    ? 'Update Configuration'
                    : 'Send Configuration')
              : (_connecting ? 'Connecting...' : 'Not Connected'),
        ),
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          backgroundColor: cs.primary,
          disabledBackgroundColor: cs.onSurfaceVariant.withValues(alpha: 0.06),
        ),
      ),
    );
  }

  /* ── Live Tab ───────────────────────────────────────────────────── */

  Widget _buildDataTab(ColorScheme cs) {
    final series = _buildLiveSeries();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        _buildSectionHeader(cs, 'Live Chart', Icons.show_chart_rounded),
        const SizedBox(height: 12),
        _buildLiveStatusCard(cs),
        const SizedBox(height: 12),
        _buildVizProfileCard(cs),
        const SizedBox(height: 12),
        if (_selectedVizProfile == null)
          _buildEmptyChartCard(cs)
        else
          _buildLiveChartCard(cs, series),
        if (series.isNotEmpty) ...[
          const SizedBox(height: 12),
          _buildLiveLegend(cs, series),
        ],
        if (_uartLogs.isNotEmpty) ...[
          const SizedBox(height: 12),
          _buildRawFrames(cs),
        ],
      ],
    );
  }

  Widget _buildLiveStatusCard(ColorScheme cs) {
    final active = _scanningUart;
    final parser = _liveParser;
    final rate = _liveRate();
    return _buildGlassCard(cs, [
      Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: active ? cs.secondary : cs.onSurfaceVariant.withValues(alpha: 0.35),
              shape: BoxShape.circle,
              boxShadow: active
                  ? [
                      BoxShadow(
                        color: cs.secondary.withValues(alpha: 0.45),
                        blurRadius: 8,
                      ),
                    ]
                  : null,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  active ? 'BLE live stream' : 'Stream stopped',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                Text(
                  active
                      ? '${rate.toStringAsFixed(1)} frames/s · ${_liveSamples.length} parsed · proto ${_resolveLiveProtocolId() ?? "none"}'
                      : 'Start to receive live UART frames from the board',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.62),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(
            height: 40,
            child: active
                ? FilledButton.tonalIcon(
                    onPressed: _stopUartStream,
                    icon: const Icon(Icons.stop_rounded, size: 16),
                    label: const Text('Stop', style: TextStyle(fontSize: 12)),
                    style: FilledButton.styleFrom(
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  )
                : FilledButton.icon(
                    onPressed: _connected ? _startUartStream : null,
                    icon: const Icon(Icons.play_arrow_rounded, size: 16),
                    label: const Text('Start', style: TextStyle(fontSize: 12)),
                    style: FilledButton.styleFrom(
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
          ),
        ],
      ),
      const SizedBox(height: 12),
      Row(
        children: [
          _liveStat(cs, 'Frames', '$_liveParsedFrames'),
          const SizedBox(width: 16),
          _liveStat(cs, 'Parsed', '${_liveSamples.length}'),
          const SizedBox(width: 16),
          _liveStat(
            cs,
            'Errors',
            '$_liveParseErrors',
            color: _liveParseErrors > 0 ? cs.error : null,
          ),
          const Spacer(),
          if (_liveSamples.isNotEmpty)
            TextButton.icon(
              onPressed: () => setState(_liveSamples.clear),
              icon: const Icon(Icons.delete_sweep_rounded, size: 15),
              label: const Text('Clear', style: TextStyle(fontSize: 11)),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                foregroundColor: cs.onSurfaceVariant.withValues(alpha: 0.6),
              ),
            ),
        ],
      ),
      if (!_scanningUart && _uartLogs.isEmpty) ...[
        const SizedBox(height: 8),
        Text(
          parser == null
              ? 'Protocol parser is not loaded yet. Reload profiles after the server is reachable.'
              : 'The chart only shows frames received from now on.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: cs.onSurfaceVariant.withValues(alpha: 0.55),
            height: 1.35,
          ),
        ),
      ],
    ]);
  }

  Widget _liveStat(ColorScheme cs, String label, String value, {Color? color}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
            color: cs.onSurfaceVariant.withValues(alpha: 0.5),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            fontFamily: 'monospace',
            color: color ?? cs.onSurface,
          ),
        ),
      ],
    );
  }

  Widget _buildVizProfileCard(ColorScheme cs) {
    final profile = _selectedVizProfile;
    final bool mismatch = profile != null &&
        profile.items.any(
          (item) =>
              item.protocolId.isNotEmpty &&
              !_itemMatchesBoard(item),
        );
    return _buildGlassCard(cs, [
      Row(
        children: [
          Icon(Icons.dashboard_customize_rounded, size: 16, color: cs.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Server chart profile',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          if (_vizProfilesLoading)
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            IconButton(
              onPressed: _loadProtocols,
              icon: const Icon(Icons.refresh_rounded, size: 18),
              visualDensity: VisualDensity.compact,
              tooltip: 'Reload protocols and profiles',
            ),
        ],
      ),
      if (_vizProfiles.isNotEmpty) ...[
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          value: _selectedVizProfileId,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: 'Profile',
            filled: true,
            fillColor: cs.surface.withValues(alpha: 0.45),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 10,
            ),
          ),
          items: _vizProfiles
              .map(
                (p) => DropdownMenuItem(
                  value: p.id,
                  child: Text(
                    '${p.name} · ${p.items.length} fields',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              )
              .toList(),
          onChanged: _selectVizProfile,
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: Text(
                _boardId == null
                    ? 'Board ID is not resolved yet.'
                    : 'Board ${_boardId!.length <= 8 ? _boardId! : _boardId!.substring(0, 8)} · ${_protocolName(_boardProtoId ?? _selectedProtoId)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.55),
                  fontFamily: 'monospace',
                  fontSize: 10,
                ),
              ),
            ),
            TextButton.icon(
              onPressed: _showFieldPicker,
              icon: const Icon(Icons.tune_rounded, size: 15),
              label: Text(
                'Fields ${_selectedChartItemIds.length}/$_maxChartSeries',
                style: const TextStyle(fontSize: 11),
              ),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
              ),
            ),
          ],
        ),
      ],
      if (_vizProfileError != null) ...[
        const SizedBox(height: 8),
        Text(
          _vizProfileError!,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: cs.error,
            height: 1.35,
          ),
        ),
      ],
      if (mismatch) ...[
        const SizedBox(height: 8),
        Text(
          'Some profile fields use a different protocol than this board. They are excluded from the chart.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: cs.tertiary,
            height: 1.35,
          ),
        ),
      ],
    ]);
  }

  Widget _buildEmptyChartCard(ColorScheme cs) {
    return _buildGlassCard(cs, [
      SizedBox(
        height: 200,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.show_chart_rounded,
                size: 34,
                color: cs.onSurfaceVariant.withValues(alpha: 0.35),
              ),
              const SizedBox(height: 10),
              Text(
                _vizProfilesLoading
                    ? 'Loading chart profile…'
                    : 'Select a server profile to start the live chart.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                ),
              ),
            ],
          ),
        ),
      ),
    ]);
  }

  Widget _buildLiveChartCard(
    ColorScheme cs,
    List<LiveChartSeries> series,
  ) {
    final profile = _selectedVizProfile;
    return _buildGlassCard(cs, [
      Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  profile?.name ?? 'Live',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  _chartFollow
                      ? 'Following live · pinch zoom · drag pan'
                      : 'Viewport paused · double-tap to follow',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.55),
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => _enterLiveFullscreen(),
            icon: const Icon(Icons.fullscreen_rounded, size: 20),
            tooltip: 'Fullscreen analyze',
            visualDensity: VisualDensity.compact,
          ),
          for (final seconds in const [30, 60, 120])
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: ChoiceChip(
                label: Text(
                  seconds < 60 ? '${seconds}s' : '${seconds ~/ 60}m',
                  style: const TextStyle(fontSize: 10),
                ),
                selected: _chartWindowSeconds == seconds,
                onSelected: (_) => _setChartWindowSeconds(seconds),
                visualDensity: VisualDensity.compact,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                padding: const EdgeInsets.symmetric(horizontal: 6),
              ),
            ),
        ],
      ),
      const SizedBox(height: 10),
      SizedBox(
        height: 300,
        child: LiveChart(
          series: series,
          initialWindowSeconds: _chartWindowSeconds,
          followResetToken: _chartFollowResetToken,
          onFollowChanged: (follow) {
            if (_chartFollow != follow) {
              setState(() => _chartFollow = follow);
            }
          },
        ),
      ),
      if (series.isEmpty || series.every((s) => s.points.isEmpty)) ...[
        const SizedBox(height: 10),
        Text(
          !_scanningUart
              ? 'Start the live stream to populate this chart.'
              : _liveParsedFrames == 0
                  ? 'Waiting for UART frames…'
                  : _liveSamples.isEmpty
                      ? 'Received $_liveParsedFrames frames but none parsed. Check protocol assignment and Errors ($_liveParseErrors).'
                      : 'Parsed ${_liveSamples.length} samples, but selected fields have no values. Open Fields and pick matching names.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: cs.onSurfaceVariant.withValues(alpha: 0.55),
          ),
        ),
      ],
    ]);
  }

  Widget _buildLiveLegend(ColorScheme cs, List<LiveChartSeries> series) {
    return _buildGlassCard(cs, [
      Wrap(
        spacing: 8,
        runSpacing: 6,
        children: [
          for (final item in series)
            GestureDetector(
              onTap: () => _toggleChartItem(item.id),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 9,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: item.color.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: item.color.withValues(alpha: 0.3),
                    width: 0.6,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: item.color,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      item.label,
                      style: const TextStyle(fontSize: 10.5),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      item.latest == null
                          ? '—'
                          : '${_formatChartValue(item.latest!)}${item.unit.isEmpty ? '' : ' ${item.unit}'}',
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        fontFamily: 'monospace',
                        color: item.color,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
      const SizedBox(height: 6),
      Align(
        alignment: Alignment.centerLeft,
        child: Text(
          'Tap a field to hide it.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: cs.onSurfaceVariant.withValues(alpha: 0.45),
            fontSize: 10,
          ),
        ),
      ),
    ]);
  }

  String _formatChartValue(double value) {
    final abs = value.abs();
    if (abs >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
    if (abs >= 10000) return '${(value / 1000).toStringAsFixed(1)}k';
    if (abs >= 100) return value.toStringAsFixed(0);
    if (abs >= 10) return value.toStringAsFixed(1);
    return value.toStringAsFixed(2);
  }

  Widget _buildRawFrames(ColorScheme cs) {
    final start = (_uartLogs.length - 10).clamp(0, _uartLogs.length).toInt();
    final recent = _uartLogs.sublist(start);
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: cs.outline.withValues(alpha: 0.3),
          width: 0.5,
        ),
      ),
      child: ExpansionTile(
        shape: const Border(),
        collapsedShape: const Border(),
        tilePadding: const EdgeInsets.symmetric(horizontal: 16),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        title: Text(
          'Raw frames (${_uartLogs.length})',
          style: Theme.of(context).textTheme.titleSmall,
        ),
        subtitle: const Text(
          'Latest 10 frames · long press to copy',
          style: TextStyle(fontSize: 10),
        ),
        children: [
          for (var i = 0; i < recent.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: _buildPacketTile(
                cs,
                recent[i],
                _uartLogs.length - start - 1 - i,
              ),
            ),
        ],
      ),
    );
  }

  String _formatPacketTime(DateTime time) {
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(time.hour)}:${two(time.minute)}:${two(time.second)}.'
        '${time.millisecond.toString().padLeft(3, '0')}';
  }

  Widget _buildPacketTile(ColorScheme cs, _UartPacket packet, int packetIndex) {
    final displayHex = packet.hex.replaceAll('01 ', '').replaceAll('02 ', '');
    final dir = packet.hex.startsWith('01')
        ? 'RX'
        : packet.hex.startsWith('02')
        ? 'TX'
        : null;

    return GestureDetector(
      onLongPress: () async {
        await Clipboard.setData(ClipboardData(text: displayHex));
        if (mounted) AppToast.success(context, 'Packet copied');
      },
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: cs.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: cs.outline.withValues(alpha: 0.2),
            width: 0.5,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (dir != null)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: dir == 'RX'
                          ? cs.secondary.withValues(alpha: 0.12)
                          : cs.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      dir,
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: dir == 'RX' ? cs.secondary : cs.primary,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                const Spacer(),
                Text(
                  _formatPacketTime(packet.receivedAt),
                  style: TextStyle(
                    fontSize: 9,
                    fontFamily: 'monospace',
                    color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'PKT #${_uartLogs.length - packetIndex}',
                  style: TextStyle(
                    fontSize: 9,
                    fontFamily: 'monospace',
                    color: cs.onSurfaceVariant.withValues(alpha: 0.3),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              displayHex,
              style: TextStyle(
                fontSize: 12,
                fontFamily: 'monospace',
                color: dir == 'RX' ? cs.secondary : cs.primary,
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /* ── Logs Tab ───────────────────────────────────────────────────── */

  String _formatLogTime(DateTime time) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(time.hour)}:${two(time.minute)}:${two(time.second)}';
  }

  Color _logColor(ColorScheme cs, _DeviceLogEntry entry) {
    final text = entry.text.toUpperCase();
    if (text.contains('FAIL') ||
        text.contains('ERROR') ||
        text.contains('TIMEOUT')) {
      return cs.error;
    }
    if (!entry.fromBoard) return cs.onSurfaceVariant;
    if (text.startsWith('[WIFI]')) return cs.primary;
    if (text.startsWith('[HTTP]')) return cs.tertiary;
    if (text.startsWith('[BLE]')) return cs.secondary;
    return cs.onSurface;
  }

  Widget _buildLogsTab(ColorScheme cs) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 10, 6),
          child: Row(
            children: [
              Icon(
                Icons.terminal_rounded,
                size: 16,
                color: cs.onSurfaceVariant.withValues(alpha: 0.6),
              ),
              const SizedBox(width: 6),
              Text(
                'Board logs',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),
              if (_logSub != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: cs.primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    'LIVE',
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      color: cs.primary,
                      letterSpacing: 0.4,
                    ),
                  ),
                ),
              const Spacer(),
              Text(
                '${_deviceLogs.length}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                ),
              ),
              IconButton(
                tooltip: 'Clear logs',
                visualDensity: VisualDensity.compact,
                onPressed: _deviceLogs.isEmpty
                    ? null
                    : () => setState(() => _deviceLogs.clear()),
                icon: Icon(
                  Icons.delete_sweep_outlined,
                  size: 18,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: _deviceLogs.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 40),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 56,
                          height: 56,
                          decoration: BoxDecoration(
                            color: cs.primary.withValues(alpha: 0.06),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Icon(
                            Icons.article_outlined,
                            size: 24,
                            color: cs.onSurfaceVariant.withValues(alpha: 0.3),
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'No logs yet',
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(
                                color: cs.onSurface.withValues(alpha: 0.6),
                              ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Connect to the board. Firmware serial logs\nwill stream here over BLE.',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                color: cs.onSurfaceVariant.withValues(
                                  alpha: 0.5,
                                ),
                                height: 1.4,
                              ),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView.builder(
                  controller: _logScrollCtrl,
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 20),
                  itemCount: _deviceLogs.length,
                  itemBuilder: (_, i) {
                    final entry = _deviceLogs[i];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 3),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _formatLogTime(entry.at),
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10,
                              height: 1.45,
                              color: cs.onSurfaceVariant.withValues(alpha: 0.4),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              entry.text,
                              style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                                height: 1.45,
                                color: _logColor(cs, entry),
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
