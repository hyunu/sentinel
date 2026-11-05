import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../ble/ble_scanner.dart';

enum SentinelDisplayState {
  unregistered,
  configured,
  connecting,
  registering,
  online,
  offline,
}

class BoardRegistryEntry {
  final String uid;
  final String macAddress;
  final bool isActive;
  final DateTime? lastHeartbeat;

  const BoardRegistryEntry({
    required this.uid,
    required this.macAddress,
    required this.isActive,
    this.lastHeartbeat,
  });

  bool get hasRecentHeartbeat => BoardStatusResolver.isRecent(lastHeartbeat);
}

/// Recent UART upload counts as server presence. Firmware stops sending
/// /heartbeat while uploads succeed, so last_heartbeat alone goes stale.
DateTime? freshestBoardPresence(DateTime? heartbeat, DateTime? uartAt) {
  DateTime? valid(DateTime? value) =>
      (value == null || value.year <= 1) ? null : value;
  final beat = valid(heartbeat);
  final uart = valid(uartAt);
  if (beat == null) return uart;
  if (uart == null) return beat;
  return beat.toUtc().isAfter(uart.toUtc()) ? beat : uart;
}

class BoardStatusResolver {
  static const _labels = {
    SentinelDisplayState.unregistered: 'Unregistered',
    SentinelDisplayState.configured: 'Configured',
    SentinelDisplayState.connecting: 'Connecting',
    SentinelDisplayState.registering: 'Registering',
    SentinelDisplayState.online: 'Online',
    SentinelDisplayState.offline: 'Offline',
  };

  static const _colors = {
    SentinelDisplayState.unregistered: Color(0xFF78909C),
    SentinelDisplayState.configured: Color(0xFF9E9EB0),
    SentinelDisplayState.connecting: Color(0xFFFF6D00),
    SentinelDisplayState.registering: Color(0xFFFFB300),
    SentinelDisplayState.online: Color(0xFF34D399),
    SentinelDisplayState.offline: Color(0xFFF472B6),
  };

  static String label(SentinelDisplayState state) => _labels[state]!;
  static Color color(SentinelDisplayState state) => _colors[state]!;

  static bool isRecent(DateTime? at) {
    if (at == null || at.year <= 1) return false;
    return DateTime.now().toUtc().difference(at.toUtc()).inMinutes < 2;
  }

  static SentinelDisplayState resolve({
    required AdvertisementData adData,
    required String deviceMac,
    BoardRegistryEntry? serverEntry,
  }) {
    return resolveSignals(
      bleState: BleScanner.parseStateFromAdData(adData),
      uid: BleScanner.parseUidFromAdData(adData),
      serverEntry: serverEntry,
    );
  }

  /// BLE manufacturer flags are the live AP/server state. A stale server
  /// heartbeat must not override them — that was marking connected boards
  /// Offline whenever `last_heartbeat` was older than two minutes.
  static SentinelDisplayState resolveSignals({
    required SentinelBleState bleState,
    String? uid,
    BoardRegistryEntry? serverEntry,
  }) {
    if (bleState == SentinelBleState.online ||
        (serverEntry?.hasRecentHeartbeat ?? false)) {
      return SentinelDisplayState.online;
    }

    switch (bleState) {
      case SentinelBleState.connecting:
        return SentinelDisplayState.connecting;
      case SentinelBleState.registering:
        return SentinelDisplayState.registering;
      case SentinelBleState.online:
        return SentinelDisplayState.online;
      case SentinelBleState.unregistered:
      case SentinelBleState.configured:
        break;
    }

    if (serverEntry != null) {
      return SentinelDisplayState.offline;
    }

    if (bleState == SentinelBleState.configured && uid != null) {
      return SentinelDisplayState.configured;
    }
    return SentinelDisplayState.unregistered;
  }
}
