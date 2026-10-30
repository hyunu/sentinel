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

const String kTemperatureProtocolId = 'temperature-telemetry-v1';
const String kDefaultServerUrl = 'http://116.39.187.5:50000';

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

class DeviceScreen extends StatefulWidget {
  final BluetoothDevice device;
  final AdvertisementData? advertisementData;
  const DeviceScreen({super.key, required this.device, this.advertisementData});

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
  bool _obscurePassword = true;
  bool _showValidation = false;
  bool _profileDetailsExpanded = true;
  List<String> _uartLogs = [];
  List<_Protocol> _protocols = [];
  String? _selectedProtoId;
  final List<String> _pendingParse = [];
  final Set<String> _pendingParseSet = {};
  final Map<String, Map<String, String>> _parsedFrames = {};
  Timer? _parseTimer;
  bool _parsingBatch = false;
  StreamSubscription? _uartSub;
  StreamSubscription? _connSub;
  StreamSubscription<String>? _logSub;
  final List<_DeviceLogEntry> _deviceLogs = [];
  final ScrollController _logScrollCtrl = ScrollController();
  String _logRxBuffer = '';
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

  String _shortUrl(String url) {
    if (url.isEmpty) return 'No server';
    return url.replaceFirst(RegExp(r'^https?://'), '');
  }

  String? get _ssidError {
    return _ssidCtrl.text.trim().isEmpty ? 'WiFi SSID is required' : null;
  }

  String? get _passwordError {
    return _passCtrl.text.trim().isEmpty ? 'WiFi password is required' : null;
  }

  String? get _baudError {
    final raw = _baudCtrl.text.trim();
    if (raw.isEmpty) return null;
    final baud = int.tryParse(raw);
    if (baud == null) return 'Baud rate must be a number';
    if (baud < 300 || baud > 2000000) {
      return 'Baud rate must be between 300 and 2,000,000';
    }
    return null;
  }

  String? get _urlError {
    final raw = _urlCtrl.text.trim();
    if (raw.isEmpty) return null;
    final normalized = StorageService.normalizeServerUrl(raw);
    final uri = Uri.tryParse(normalized);
    if (uri == null ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.host.isEmpty) {
      return 'Enter a valid http:// or https:// server URL';
    }
    return null;
  }

  String? get _formError =>
      _ssidError ?? _passwordError ?? _baudError ?? _urlError;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 4, vsync: this);
    _onboardingProfiler.addListener(_onProfilerUpdated);
    for (final c in [_ssidCtrl, _passCtrl, _baudCtrl, _urlCtrl]) {
      c.addListener(_onFieldChanged);
    }
    _loadSaved();
    _connect();
    _parseTimer = Timer.periodic(
      const Duration(milliseconds: 700),
      (_) => _flushParseBatch(),
    );
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
    _parseTimer?.cancel();
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

  Future<void> _loadSaved() async {
    await _loadOnboardingProfiles();
    if (_onboardingProfiles.isEmpty) {
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
      _profileDetailsExpanded = selected == null;
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
    _showValidation = false;
    _profileDetailsExpanded = false;
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

  Future<void> _promptSaveProfile({bool asNew = false}) async {
    final ssid = _ssidCtrl.text.trim();
    if (ssid.isEmpty) {
      AppToast.error(
        context,
        'Enter a WiFi SSID before saving a profile.',
        persistent: false,
      );
      return;
    }

    final nameCtrl = TextEditingController(
      text: asNew ? '' : (_selectedProfile?.name ?? ssid),
    );
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

    final profile = _profileFromFields(
      id: asNew ? null : _selectedProfileId,
      name: name,
    );
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
    }
    // Guard against a malformed peer that never sends a newline.
    if (_logRxBuffer.length > 4096) {
      _logRxBuffer = _logRxBuffer.substring(_logRxBuffer.length - 2048);
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

  Future<void> _connect() async {
    _addLog('Connecting to ${widget.device.remoteId.str}...');
    setState(() => _connecting = true);
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

    await _connSub?.cancel();
    _scanner.clearCache();
    _connSub = widget.device.connectionState.listen((s) {
      if (mounted) {
        setState(() {
          _connected = s == BluetoothConnectionState.connected;
          if (!_connected) _connecting = false;
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
            if (_selectedProtoId == null || _selectedProtoId!.isEmpty) {
              final defaultProto = _protocols.where(
                (p) => p.id == kTemperatureProtocolId,
              );
              _selectedProtoId = defaultProto.isNotEmpty
                  ? defaultProto.first.id
                  : (_protocols.isNotEmpty ? _protocols.first.id : null);
            }
          });
        }
      }
    } catch (_) {}
    await _syncBoardFromServer();
  }

  Future<void> _syncBoardFromServer() async {
    try {
      final base = _baseUrl;
      final bleMac = widget.device.remoteId.str;
      final res = await http
          .get(Uri.parse('$base/api/v1/boards'))
          .timeout(const Duration(seconds: 5));
      if (res.statusCode != 200 || !mounted) return;

      for (final raw in json.decode(res.body) as List) {
        if (raw is! Map) continue;
        if (raw['mac_address']?.toString() != bleMac) continue;
        final protocolId = raw['protocol_id']?.toString();
        setState(() {
          if (protocolId != null &&
              protocolId.isNotEmpty &&
              protocolId != _selectedProtoId) {
            _selectedProtoId = protocolId;
            _resetParsedFrames();
          }
        });
        break;
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
    final validationError = _formError;
    if (validationError != null) {
      setState(() => _showValidation = true);
      AppToast.error(context, validationError, persistent: false);
      return;
    }
    if (ssid.isEmpty) return;

    _onboardingProfiler.begin();
    setState(() => _sendingWifi = true);
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
          _showError('Cannot reach the server. Check the server URL.');
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
      if (mounted) _showError(_onboardingErrorMessage(e));
      _addLog('Onboarding failed: $e');
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
        final hex = data
            .map((b) => b.toRadixString(16).padLeft(2, '0'))
            .join(' ');
        setState(() {
          _uartLogs.add(hex);
          if (_uartLogs.length > 500) _uartLogs = _uartLogs.sublist(-500);
        });
        _enqueueParse(hex);
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

  void _onProtocolChanged(String? id) {
    setState(() {
      _selectedProtoId = id;
      _resetParsedFrames();
    });
  }

  _Protocol? get _selectedProtocol {
    if (_selectedProtoId == null) return null;
    for (final protocol in _protocols) {
      if (protocol.id == _selectedProtoId) return protocol;
    }
    return null;
  }

  void _resetParsedFrames() {
    _pendingParse.clear();
    _pendingParseSet.clear();
    _parsedFrames.clear();
  }

  void _enqueueParse(String hex) {
    final protocol = _selectedProtocol;
    if (protocol == null || !protocol.hasParseRules) return;
    if (_parsedFrames.containsKey(hex) || _pendingParseSet.contains(hex))
      return;
    if (_pendingParse.length >= 200) return;
    _pendingParse.add(hex);
    _pendingParseSet.add(hex);
  }

  Future<void> _flushParseBatch() async {
    if (_parsingBatch || _pendingParse.isEmpty) return;
    final protocol = _selectedProtocol;
    if (protocol == null || !protocol.hasParseRules) {
      _pendingParse.clear();
      _pendingParseSet.clear();
      return;
    }

    final batch = _pendingParse.take(100).toList();
    _pendingParse.removeRange(0, batch.length);
    _pendingParseSet.removeAll(batch);
    _parsingBatch = true;

    try {
      final response = await http
          .post(
            Uri.parse('$_baseUrl/api/v1/protocols/parse/batch'),
            headers: {'Content-Type': 'application/json'},
            body: json.encode({'protocol_id': protocol.id, 'frames': batch}),
          )
          .timeout(const Duration(seconds: 4));

      if (response.statusCode != 200) return;
      final decoded = json.decode(response.body);
      final results = decoded is Map ? decoded['results'] : null;
      if (results is! List) return;

      final parsedBatch = <String, Map<String, String>>{};
      for (final raw in results) {
        if (raw is! Map) continue;
        final hex = raw['raw_hex']?.toString() ?? '';
        final fields = raw['parsed_fields'];
        if (hex.isEmpty || fields is! Map) continue;
        parsedBatch[hex] = {
          for (final entry in fields.entries)
            entry.key.toString(): _formatParsedValue(entry.value),
        };
      }

      if (!mounted || parsedBatch.isEmpty) return;
      setState(() {
        for (final entry in parsedBatch.entries) {
          _parsedFrames[entry.key] = entry.value;
        }
        while (_parsedFrames.length > 500) {
          _parsedFrames.remove(_parsedFrames.keys.first);
        }
      });
    } catch (_) {
      // Keep raw data visible when the server is unreachable.
    } finally {
      _parsingBatch = false;
    }
  }

  String _formatParsedValue(dynamic value) {
    if (value == null) return 'null';
    if (value is double) {
      if (value == value.roundToDouble()) return value.toStringAsFixed(0);
      return value.toString();
    }
    if (value is num || value is bool) return value.toString();
    if (value is List) return value.map(_formatParsedValue).join(', ');
    if (value is Map) {
      return value.entries
          .map((entry) => '${entry.key}=${_formatParsedValue(entry.value)}')
          .join(', ');
    }
    return value.toString();
  }

  Map<String, String> _parseHex(String hex, _Protocol proto) {
    if (proto.hasParseRules) {
      if (proto.id != _selectedProtoId) return <String, String>{};
      return _parsedFrames[hex] ?? <String, String>{};
    }
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
        : (
            cs.onSurfaceVariant.withValues(alpha: 0.06),
            cs.onSurfaceVariant.withValues(alpha: 0.3),
            'Offline',
          );

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
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: dot,
            ),
          ),
        ],
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
          Tab(text: 'Data'),
          Tab(text: 'Monitor'),
          Tab(text: 'Logs'),
        ],
      ),
    );
  }

  /* ── Control Tab ────────────────────────────────────────────────── */

  Widget _buildControlTab(ColorScheme cs) {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _buildSectionHeader(cs, 'Onboarding', Icons.tune_rounded),
                const SizedBox(height: 12),
                _buildOnboardingProfilesSection(cs),
                const SizedBox(height: 12),
                if (_selectedProfile != null && !_profileDetailsExpanded)
                  _buildSelectedProfileSummary(cs, _selectedProfile!)
                else
                  _buildConnectionFormCard(cs),
                if (_onboardingProfiler.steps.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  _buildSectionHeader(
                    cs,
                    'Step timeline',
                    Icons.timeline_rounded,
                  ),
                  const SizedBox(height: 12),
                  _buildOnboardingProfileCard(cs),
                ],
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
        _buildControlActionBar(cs),
      ],
    );
  }

  Widget _buildSelectedProfileSummary(
    ColorScheme cs,
    OnboardingProfile profile,
  ) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: cs.outline.withValues(alpha: 0.3),
          width: 0.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: cs.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.wifi_rounded, size: 18, color: cs.primary),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      profile.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      profile.ssid,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                      ),
                    ),
                  ],
                ),
              ),
              OutlinedButton.icon(
                onPressed: () {
                  setState(() => _profileDetailsExpanded = true);
                },
                icon: const Icon(Icons.edit_outlined, size: 15),
                label: const Text('Edit'),
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                ),
              ),
            ],
          ),
          const Divider(height: 22),
          _buildProfileSummaryRow(cs, 'Server', _shortUrl(profile.serverUrl)),
          const SizedBox(height: 6),
          _buildProfileSummaryRow(
            cs,
            'Baud',
            profile.baudRate?.toString() ?? 'Default',
          ),
          const SizedBox(height: 10),
          Text(
            'Ready to send this profile. Press Send below to apply it to the board.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: cs.onSurfaceVariant.withValues(alpha: 0.65),
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProfileSummaryRow(ColorScheme cs, String label, String value) {
    return Row(
      children: [
        SizedBox(
          width: 58,
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: cs.onSurfaceVariant.withValues(alpha: 0.6),
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: cs.onSurface,
              fontFamily: 'monospace',
              fontSize: 11,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildConnectionFormCard(ColorScheme cs) {
    return _buildGlassCard(cs, [
      if (_selectedProfile != null) ...[
        Row(
          children: [
            Expanded(
              child: Text(
                'Connection details',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
            TextButton.icon(
              onPressed: () {
                setState(() => _profileDetailsExpanded = false);
              },
              icon: const Icon(Icons.keyboard_arrow_up_rounded, size: 16),
              label: const Text('Hide'),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 8),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
      ],
      _buildFormGroupLabel(cs, 'WiFi network'),
      const SizedBox(height: 8),
      _buildTextField(
        cs,
        _ssidCtrl,
        'WiFi SSID',
        Icons.wifi_rounded,
        placeholder: 'e.g. rLGE',
        errorText: _showValidation ? _ssidError : null,
        textInputAction: TextInputAction.next,
      ),
      const SizedBox(height: 10),
      _buildTextField(
        cs,
        _passCtrl,
        'WiFi password',
        Icons.lock_rounded,
        obscure: _obscurePassword,
        showObscureToggle: true,
        errorText: _showValidation ? _passwordError : null,
        textInputAction: TextInputAction.next,
      ),
      const SizedBox(height: 16),
      _buildFormGroupLabel(cs, 'Device'),
      const SizedBox(height: 8),
      _buildTextField(
        cs,
        _baudCtrl,
        'Baud rate',
        Icons.speed_rounded,
        placeholder: '19200',
        errorText: _showValidation ? _baudError : null,
        keyboardType: TextInputType.number,
        textInputAction: TextInputAction.next,
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
        errorText: _showValidation ? _urlError : null,
        helperText: 'ESP32 heartbeat and onboarding endpoint',
        keyboardType: TextInputType.url,
        textInputAction: TextInputAction.done,
      ),
      const SizedBox(height: 16),
      _buildFormGroupLabel(cs, 'Protocol'),
      const SizedBox(height: 8),
      if (_protocols.isEmpty)
        Text(
          'Load protocols from the server URL above.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: cs.onSurfaceVariant.withValues(alpha: 0.65),
          ),
        )
      else
        DropdownButtonFormField<String>(
          key: ValueKey(_selectedProtoId),
          initialValue: _selectedProtoId,
          decoration: InputDecoration(
            labelText: 'UART parse protocol',
            filled: true,
            fillColor: cs.surface.withValues(alpha: 0.45),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
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
    ]);
  }

  Widget _buildControlActionBar(ColorScheme cs) {
    final busy = _sendingWifi || _connecting;
    final hasError = _formError != null;
    final label = !_connected
        ? 'Reconnect'
        : _wifiConfigured
        ? 'Update'
        : 'Send';
    final helper = !_connected
        ? 'Board is not connected'
        : hasError
        ? (_showValidation
              ? 'Check the highlighted fields'
              : 'Enter WiFi credentials')
        : (_selectedProfile != null && !_profileDetailsExpanded
              ? 'Ready to send selected profile'
              : 'Changes are sent over BLE');

    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        decoration: BoxDecoration(
          color: cs.surface,
          border: Border(
            top: BorderSide(
              color: cs.outline.withValues(alpha: 0.25),
              width: 0.5,
            ),
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    !_connected
                        ? 'BLE connection'
                        : _wifiConfigured
                        ? 'Configuration'
                        : 'Onboarding',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    helper,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: cs.onSurfaceVariant.withValues(alpha: 0.65),
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            FilledButton.icon(
              onPressed: busy ? null : (_connected ? _sendWifi : _connect),
              icon: busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Icon(
                      !_connected
                          ? Icons.bluetooth_searching_rounded
                          : Icons.send_rounded,
                      size: 18,
                    ),
              label: Text(
                busy ? (_connecting ? 'Connecting...' : 'Sending...') : label,
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 46),
                padding: const EdgeInsets.symmetric(horizontal: 18),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOnboardingProfilesSection(ColorScheme cs) {
    final selected = _selectedProfile;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      decoration: BoxDecoration(
        color: cs.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: cs.outline.withValues(alpha: 0.3),
          width: 0.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(
                Icons.bookmarks_outlined,
                size: 16,
                color: cs.primary.withValues(alpha: 0.8),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Saved profiles',
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
              if (_onboardingProfiles.isNotEmpty)
                Text(
                  '${_onboardingProfiles.length} saved',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                  ),
                ),
              IconButton(
                tooltip: 'New profile',
                visualDensity: VisualDensity.compact,
                onPressed: () => _promptSaveProfile(asNew: true),
                icon: Icon(
                  Icons.add_rounded,
                  size: 18,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (_onboardingProfiles.isEmpty) ...[
            Text(
              'Save the WiFi and server settings below as a reusable preset.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                height: 1.35,
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _promptSaveProfile,
                icon: const Icon(Icons.add_rounded, size: 16),
                label: const Text('Save current settings'),
              ),
            ),
          ] else ...[
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: ValueKey(_selectedProfileId),
                    initialValue: _selectedProfileId,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: 'Profile',
                      filled: true,
                      fillColor: cs.surface.withValues(alpha: 0.45),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    items: _onboardingProfiles
                        .map(
                          (p) => DropdownMenuItem(
                            value: p.id,
                            child: Text(
                              p.name,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (id) {
                      if (id == null) return;
                      for (final p in _onboardingProfiles) {
                        if (p.id == id) {
                          _selectProfile(p);
                          break;
                        }
                      }
                    },
                  ),
                ),
                const SizedBox(width: 4),
                IconButton(
                  tooltip: 'Save current values as profile',
                  onPressed: _promptSaveProfile,
                  icon: Icon(
                    Icons.save_outlined,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                  ),
                ),
                if (selected != null)
                  PopupMenuButton<String>(
                    tooltip: 'Profile actions',
                    icon: Icon(
                      Icons.more_vert_rounded,
                      color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                    ),
                    onSelected: (action) {
                      if (action == 'rename') {
                        _promptRenameProfile(selected);
                      } else if (action == 'delete') {
                        _confirmDeleteProfile(selected);
                      }
                    },
                    itemBuilder: (_) => [
                      const PopupMenuItem(
                        value: 'rename',
                        child: Text('Rename'),
                      ),
                      PopupMenuItem(
                        value: 'delete',
                        child: Text(
                          'Delete',
                          style: TextStyle(color: cs.error),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Select a profile and press Send, or tap Edit to change its details.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                height: 1.35,
              ),
            ),
          ],
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
    String? errorText,
    String? helperText,
    TextInputType? keyboardType,
    TextInputAction? textInputAction,
    bool showObscureToggle = false,
  }) {
    return TextField(
      controller: ctrl,
      obscureText: obscure,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      style: TextStyle(fontSize: 14, color: cs.onSurface),
      decoration: InputDecoration(
        labelText: label,
        hintText: placeholder,
        helperText: helperText,
        errorText: errorText,
        prefixIcon: Icon(
          icon,
          size: 18,
          color: cs.primary.withValues(alpha: 0.6),
        ),
        suffixIcon: showObscureToggle
            ? IconButton(
                tooltip: obscure ? 'Show password' : 'Hide password',
                onPressed: () {
                  setState(() => _obscurePassword = !_obscurePassword);
                },
                icon: Icon(
                  obscure
                      ? Icons.visibility_rounded
                      : Icons.visibility_off_rounded,
                  size: 18,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.65),
                ),
              )
            : null,
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

  /* ── Data Tab ───────────────────────────────────────────────────── */

  Widget _buildDataTab(ColorScheme cs) {
    final selectedProto = _protocols.firstWhere(
      (p) => p.id == _selectedProtoId,
      orElse: () => _protocols.isNotEmpty
          ? _protocols.first
          : _Protocol.fromJson({
              'id': '',
              'name': '',
              'version': '',
              'fields': [],
            }),
    );
    final showParsed =
        selectedProto.hasParseRules || selectedProto.fields.isNotEmpty;

    if (_protocols.isEmpty && !_scanningUart) {
      return Center(
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
                  Icons.analytics_outlined,
                  size: 24,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.3),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'No data yet',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: cs.onSurface.withValues(alpha: 0.6),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Start the UART stream to\nview parsed data',
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
                hint: Text(
                  'Select protocol',
                  style: TextStyle(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                  ),
                ),
                isExpanded: true,
                dropdownColor: cs.surfaceContainerHigh,
                underline: const SizedBox(),
                items: _protocols
                    .map(
                      (p) => DropdownMenuItem(
                        value: p.id,
                        child: Text(
                          p.fields.isNotEmpty
                              ? '${p.name} v${p.version} · ${p.fields.length} fields'
                              : '${p.name} v${p.version}',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    )
                    .toList(),
                onChanged: _onProtocolChanged,
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
                    children: selectedProto.fields
                        .map(
                          (f) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 3),
                            child: Row(
                              children: [
                                Text(
                                  f.name,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: cs.onSurfaceVariant.withValues(
                                      alpha: 0.7,
                                    ),
                                  ),
                                ),
                                const Spacer(),
                                Text(
                                  '${f.type}${f.unit != null ? " (${f.unit})" : ""}',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: cs.primary.withValues(alpha: 0.6),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                        .toList(),
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
                          label: const Text(
                            'Stop',
                            style: TextStyle(fontSize: 12),
                          ),
                          style: FilledButton.styleFrom(
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                        )
                      : FilledButton.icon(
                          onPressed: _connected ? _startUartStream : null,
                          icon: const Icon(Icons.play_arrow_rounded, size: 16),
                          label: const Text(
                            'Start',
                            style: TextStyle(fontSize: 12),
                          ),
                          style: FilledButton.styleFrom(
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
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

  /* ── Monitor Tab ────────────────────────────────────────────────── */

  Widget _buildMonitorTab(ColorScheme cs) {
    final selectedProto = _protocols.firstWhere(
      (p) => p.id == _selectedProtoId,
      orElse: () => _protocols.isNotEmpty
          ? _protocols.first
          : _Protocol.fromJson({
              'id': '',
              'name': '',
              'version': '',
              'fields': [],
            }),
    );
    final showParsed =
        selectedProto.hasParseRules || selectedProto.fields.isNotEmpty;

    if (_uartLogs.isEmpty) {
      return Center(
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
                  Icons.terminal_rounded,
                  size: 24,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.3),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Monitor',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: cs.onSurface.withValues(alpha: 0.6),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Start the UART stream from\nthe Data tab to monitor traffic',
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
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.delete_sweep,
                        size: 14,
                        color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Clear',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                          color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                        ),
                      ),
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
              final parsed = showParsed
                  ? _parseHex(hex, selectedProto)
                  : <String, String>{};
              final dir = hex.startsWith('01')
                  ? 'RX'
                  : hex.startsWith('02')
                  ? 'TX'
                  : null;

              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
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
                                  color: dir == 'RX'
                                      ? cs.secondary
                                      : cs.primary,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ),
                          const Spacer(),
                          Text(
                            'PKT #${_uartLogs.length - i}',
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
                            children: parsed.entries
                                .map(
                                  (e) => Text(
                                    '${e.key}: ${e.value}',
                                    style: TextStyle(
                                      fontSize: 10,
                                      color: cs.onSurfaceVariant.withValues(
                                        alpha: 0.7,
                                      ),
                                    ),
                                  ),
                                )
                                .toList(),
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
