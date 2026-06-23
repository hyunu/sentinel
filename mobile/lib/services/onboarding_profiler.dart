import 'package:flutter/foundation.dart';

enum OnboardingStepStatus { pending, running, done, failed }

class OnboardingStepRecord {
  final String id;
  final String label;
  final OnboardingStepStatus status;
  final DateTime? startedAt;
  final DateTime? endedAt;
  final int? durationMs;
  final String? note;

  const OnboardingStepRecord({
    required this.id,
    required this.label,
    this.status = OnboardingStepStatus.pending,
    this.startedAt,
    this.endedAt,
    this.durationMs,
    this.note,
  });

  OnboardingStepRecord copyWith({
    OnboardingStepStatus? status,
    DateTime? startedAt,
    DateTime? endedAt,
    int? durationMs,
    String? note,
  }) {
    return OnboardingStepRecord(
      id: id,
      label: label,
      status: status ?? this.status,
      startedAt: startedAt ?? this.startedAt,
      endedAt: endedAt ?? this.endedAt,
      durationMs: durationMs ?? this.durationMs,
      note: note ?? this.note,
    );
  }
}

class OnboardingProfiler extends ChangeNotifier {
  static const stepOrder = [
    'server_reachable',
    'uid_claimed',
    'ble_subscribed',
    'config_sent',
    'wifi_connected',
    'heartbeat_ok',
    'board_ready',
    'registered',
    'completed',
  ];

  static const stepLabels = {
    'server_reachable': 'Server reachable',
    'uid_claimed': 'UID claimed',
    'ble_subscribed': 'BLE logs subscribed',
    'config_sent': 'Config sent over BLE',
    'wifi_connected': 'WiFi connected',
    'heartbeat_ok': 'Heartbeat OK',
    'board_ready': 'Board ready',
    'registered': 'Server registration',
    'completed': 'Completed',
  };

  final Stopwatch _total = Stopwatch();
  final List<OnboardingStepRecord> _steps = [];
  bool _running = false;
  bool _failed = false;
  String? _failedStepId;

  List<OnboardingStepRecord> get steps => List.unmodifiable(_steps);
  bool get isRunning => _running;
  bool get hasFailed => _failed;
  String? get failedStepId => _failedStepId;
  int get totalMs => _total.elapsedMilliseconds;

  void begin() {
    _steps.clear();
    _running = true;
    _failed = false;
    _failedStepId = null;
    _total
      ..reset()
      ..start();
    for (final id in stepOrder) {
      _steps.add(OnboardingStepRecord(id: id, label: stepLabels[id]!));
    }
    notifyListeners();
  }

  void startStep(String id, {String? note}) {
    final idx = _indexOf(id);
    if (idx < 0) return;
    final now = DateTime.now();
    _steps[idx] = _steps[idx].copyWith(
      status: OnboardingStepStatus.running,
      startedAt: now,
      note: note,
    );
    notifyListeners();
  }

  void completeStep(String id, {String? note}) {
    final idx = _indexOf(id);
    if (idx < 0) return;
    final now = DateTime.now();
    final started = _steps[idx].startedAt ?? now;
    _steps[idx] = _steps[idx].copyWith(
      status: OnboardingStepStatus.done,
      endedAt: now,
      durationMs: now.difference(started).inMilliseconds,
      note: note ?? _steps[idx].note,
    );
    notifyListeners();
  }

  void markInstant(String id, {String? note}) {
    startStep(id, note: note);
    completeStep(id, note: note);
  }

  void markBleEvent(String event) {
    if (event.contains('EVENT:WIFI_CONNECTED')) {
      markInstant('wifi_connected');
    } else if (event.contains('EVENT:HEARTBEAT_OK')) {
      markInstant('heartbeat_ok');
    }
  }

  void finishSuccess({String? uid}) {
    markInstant('completed', note: uid != null ? 'UID $uid' : null);
    _running = false;
    _total.stop();
    notifyListeners();
  }

  void finishFailure(String stepId, {String? note}) {
    final idx = _indexOf(stepId);
    if (idx >= 0) {
      final now = DateTime.now();
      final started = _steps[idx].startedAt ?? now;
      _steps[idx] = _steps[idx].copyWith(
        status: OnboardingStepStatus.failed,
        endedAt: now,
        durationMs: now.difference(started).inMilliseconds,
        note: note,
      );
    }
    _failed = true;
    _failedStepId = stepId;
    _running = false;
    _total.stop();
    notifyListeners();
    _logSummary();
  }

  void _logSummary() {
    final buffer = StringBuffer('Onboarding profile (${totalMs}ms total)\n');
    for (final step in _steps) {
      if (step.status == OnboardingStepStatus.pending) continue;
      final ms = step.durationMs ?? 0;
      buffer.writeln('- ${step.label}: ${ms}ms${step.note != null ? ' (${step.note})' : ''}');
    }
    debugPrint(buffer.toString());
  }

  int _indexOf(String id) => _steps.indexWhere((s) => s.id == id);
}
