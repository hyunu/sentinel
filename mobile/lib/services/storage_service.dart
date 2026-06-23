import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/onboarding_profile.dart';

class StorageService {
  static const _serverUrlKey = 'server_url';
  static const _wifiProfilesKey = 'wifi_profiles';
  static const _onboardingProfilesKey = 'onboarding_profiles';
  static const _lastOnboardingProfileIdKey = 'last_onboarding_profile_id';

  Future<String?> getServerUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_serverUrlKey);
  }

  Future<void> setServerUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverUrlKey, url);
  }

  Future<Map<String, String>> getWifiProfiles() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_wifiProfilesKey);
    if (raw == null) return {};
    try {
      final decoded = json.decode(raw);
      if (decoded is Map) {
        return Map<String, String>.from(decoded);
      }
    } catch (_) {}
    return {};
  }

  Future<void> saveWifiProfile(String ssid, String password) async {
    final prefs = await SharedPreferences.getInstance();
    final profiles = await getWifiProfiles();
    profiles[ssid] = password;
    await prefs.setString(_wifiProfilesKey, json.encode(profiles));
  }

  Future<List<OnboardingProfile>> getOnboardingProfiles() async {
    final prefs = await SharedPreferences.getInstance();
    await _migrateLegacyWifiProfiles(prefs);

    final raw = prefs.getString(_onboardingProfilesKey);
    if (raw == null) return [];
    try {
      final decoded = json.decode(raw);
      if (decoded is! List) return [];
      return decoded
          .whereType<Map>()
          .map((e) => OnboardingProfile.fromJson(Map<String, dynamic>.from(e)))
          .where((p) => p.id.isNotEmpty && p.ssid.isNotEmpty)
          .toList()
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    } catch (_) {
      return [];
    }
  }

  Future<void> saveOnboardingProfile(OnboardingProfile profile) async {
    final prefs = await SharedPreferences.getInstance();
    final profiles = await getOnboardingProfiles();
    final idx = profiles.indexWhere((p) => p.id == profile.id);
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.add(profile);
    }
    profiles.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    await prefs.setString(
      _onboardingProfilesKey,
      json.encode(profiles.map((p) => p.toJson()).toList()),
    );
    await setLastOnboardingProfileId(profile.id);
  }

  Future<void> deleteOnboardingProfile(String id) async {
    final prefs = await SharedPreferences.getInstance();
    final profiles = await getOnboardingProfiles();
    profiles.removeWhere((p) => p.id == id);
    await prefs.setString(
      _onboardingProfilesKey,
      json.encode(profiles.map((p) => p.toJson()).toList()),
    );
    if (await getLastOnboardingProfileId() == id) {
      await prefs.remove(_lastOnboardingProfileIdKey);
    }
  }

  Future<String?> getLastOnboardingProfileId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_lastOnboardingProfileIdKey);
  }

  Future<void> setLastOnboardingProfileId(String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastOnboardingProfileIdKey, id);
  }

  Future<void> _migrateLegacyWifiProfiles(SharedPreferences prefs) async {
    if (prefs.containsKey(_onboardingProfilesKey)) return;
    final legacy = await getWifiProfiles();
    if (legacy.isEmpty) return;

    final serverUrl = prefs.getString(_serverUrlKey) ?? '';
    final now = DateTime.now();
    final migrated = legacy.entries.map((e) {
      return OnboardingProfile(
        id: 'legacy-${e.key.hashCode.abs()}',
        name: e.key,
        ssid: e.key,
        password: e.value,
        serverUrl: serverUrl,
        baudRate: 19200,
        updatedAt: now,
      );
    }).toList();

    await prefs.setString(
      _onboardingProfilesKey,
      json.encode(migrated.map((p) => p.toJson()).toList()),
    );
  }
}
