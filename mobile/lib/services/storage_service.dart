import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class StorageService {
  Future<String?> getServerUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('server_url');
  }

  Future<void> setServerUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', url);
  }

  Future<Map<String, String>> getWifiProfiles() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('wifi_profiles');
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
    await prefs.setString('wifi_profiles', json.encode(profiles));
  }
}
