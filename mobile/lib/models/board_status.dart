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

  bool get hasRecentHeartbeat {
    if (lastHeartbeat == null || lastHeartbeat!.year <= 1) return false;
    return DateTime.now().toUtc().difference(lastHeartbeat!.toUtc()).inMinutes < 2;
  }
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

  static SentinelDisplayState resolve({
    required AdvertisementData adData,
    required String deviceMac,
    BoardRegistryEntry? serverEntry,
  }) {
    final bleState = BleScanner.parseStateFromAdData(adData);
    final uid = BleScanner.parseUidFromAdData(adData);

    if (serverEntry != null) {
      if (serverEntry.hasRecentHeartbeat) {
        return SentinelDisplayState.online;
      }
      if (serverEntry.isActive || serverEntry.macAddress.isNotEmpty) {
        return SentinelDisplayState.offline;
      }
    }

    switch (bleState) {
      case SentinelBleState.unregistered:
        return SentinelDisplayState.unregistered;
      case SentinelBleState.configured:
        return uid != null
            ? SentinelDisplayState.configured
            : SentinelDisplayState.unregistered;
      case SentinelBleState.connecting:
        return SentinelDisplayState.connecting;
      case SentinelBleState.registering:
        return SentinelDisplayState.registering;
      case SentinelBleState.online:
        return SentinelDisplayState.online;
    }
  }
}
