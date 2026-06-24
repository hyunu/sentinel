#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>

#include "wifi_manager.h"
#include "config.h"
#include "ble_service.h"

static String board_id;
static unsigned long lastHeartbeat = 0;
static bool connecting = false;
static bool pendingInitialHeartbeat = false;
static unsigned long wifiConnectedAt = 0;

static String backend_url = String(BACKEND_URL);
static String board_uid = String("");

static const char *NVS_NS = "sentinel";

static void nvs_save_string(const char *key, const String &val) {
    Preferences prefs;
    prefs.begin(NVS_NS, false);
    prefs.putString(key, val);
    prefs.end();
}

static String nvs_load_string(const char *key, const String &fallback = "") {
    Preferences prefs;
    prefs.begin(NVS_NS, true);
    String val = prefs.getString(key, fallback);
    prefs.end();
    return val;
}

static bool hasValidIp() {
    return WiFi.localIP() != IPAddress(0, 0, 0, 0);
}

static bool waitForWifiReady(uint32_t timeoutMs) {
    const unsigned long start = millis();
    int stableCount = 0;
    while (millis() - start < timeoutMs) {
        if (WiFi.status() == WL_CONNECTED && hasValidIp()) {
            stableCount++;
            if (stableCount >= 3) return true;
        } else {
            stableCount = 0;
        }
        delay(200);
        yield();
    }
    return WiFi.status() == WL_CONNECTED && hasValidIp();
}

static String getBoardId() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char buf[32];
    snprintf(buf, sizeof(buf), "%s_%02x%02x%02x%02x%02x%02x",
             BOARD_ID_PREFIX, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return String(buf);
}

void wifi_init() {
    board_id = getBoardId();
    Serial.printf("[WiFi] Board ID: %s\n", board_id.c_str());
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.setSleep(false);

    const String storedUid = nvs_load_string("uid");
    if (storedUid.length() > 0) {
        board_uid = storedUid;
        ble_preload_uid(storedUid);
        Serial.printf("[WiFi] Restored UID: %s\n", board_uid.c_str());
    }

    const String storedUrl = nvs_load_string("url");
    if (storedUrl.length() > 0) {
        backend_url = storedUrl;
        Serial.printf("[WiFi] Restored backend URL: %s\n", backend_url.c_str());
    }
}

void wifi_startup() {
    const String ssid = nvs_load_string("ssid");
    const String pass = nvs_load_string("pass");
    if (ssid.length() > 0 && pass.length() > 0) {
        Serial.printf("[WiFi] Auto-connect to stored network: %s\n", ssid.c_str());
        wifi_connect(ssid, pass);
    }
}

void wifi_connect(const String &ssid, const String &password) {
    pendingInitialHeartbeat = false;
    wifiConnectedAt = 0;

    nvs_save_string("ssid", ssid);
    nvs_save_string("pass", password);

    // Same network already up — re-run onboarding heartbeat without reconnecting
    if (WiFi.status() == WL_CONNECTED && WiFi.SSID() == ssid && hasValidIp()) {
        Serial.printf("[WiFi] Already connected to %s — scheduling onboarding heartbeat\n", ssid.c_str());
        connecting = false;
        pendingInitialHeartbeat = true;
        wifiConnectedAt = millis() - 3000; // fire on next wifi_loop (~immediate)
        ble_set_wifi_connected(true);
        ble_send_uart_data(String("EVENT:WIFI_CONNECTED"));
        return;
    }

    connecting = true;
    Serial.printf("[WiFi] Connecting to %s...\n", ssid.c_str());
    WiFi.disconnect(false);
    delay(100);
    WiFi.begin(ssid.c_str(), password.c_str());
}

bool wifi_is_connected() {
    return WiFi.status() == WL_CONNECTED;
}

void wifi_loop() {
    if (connecting && WiFi.status() == WL_CONNECTED && hasValidIp()) {
        connecting = false;
        pendingInitialHeartbeat = true;
        wifiConnectedAt = millis();
        Serial.printf("[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
        ble_set_wifi_connected(true);
        ble_send_uart_data(String("EVENT:WIFI_CONNECTED"));
    }

    if (pendingInitialHeartbeat && millis() - wifiConnectedAt >= 2500) {
        pendingInitialHeartbeat = false;
        if (!waitForWifiReady(15000)) {
            Serial.println("[WiFi] Network not stable before initial heartbeat");
            ble_send_uart_data(String("EVENT:HEARTBEAT_FAILED"));
            return;
        }

        bool ok = wifi_send_heartbeat();
        if (ok) {
            ble_set_server_registered(true);
            ble_send_uart_data(String("EVENT:HEARTBEAT_OK"));
        } else {
            ble_set_server_registered(false);
            ble_send_uart_data(String("EVENT:HEARTBEAT_FAILED"));
        }
    }
}

void wifi_set_server_url(const String &url) {
    if (url.length() == 0) return;
    backend_url = url;
    nvs_save_string("url", url);
    Serial.printf("[WiFi] Backend URL updated: %s\n", backend_url.c_str());
}

void wifi_set_uid(const String &uid) {
    if (uid.length() == 0) return;
    board_uid = uid;
    nvs_save_string("uid", uid);
    Serial.printf("[WiFi] UID updated: %s\n", board_uid.c_str());
    ble_set_uid(uid);
}

static int http_post(const String &path, const String &body) {
    if (!wifi_is_connected() || !hasValidIp()) return -1;

    HTTPClient http;
    String url = backend_url + path;

    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(10000);

    int code = http.POST(body);
    if (code > 0) {
        Serial.printf("[HTTP] POST %s: %d\n", path.c_str(), code);
    } else {
        Serial.printf("[HTTP] POST %s failed: %d\n", path.c_str(), code);
    }

    http.end();
    return code;
}

static bool httpOk(int code) {
    return code >= 200 && code < 300;
}

static String buildHeartbeatBody() {
    char buf[320];
    int pos = snprintf(buf, sizeof(buf), "{\"board_id\":\"%s\"", board_id.c_str());
    if (board_uid.length() > 0) {
        pos += snprintf(buf + pos, sizeof(buf) - pos, ",\"uid\":\"%s\"", board_uid.c_str());
    }
    pos += snprintf(buf + pos, sizeof(buf) - pos,
                    ",\"firmware_version\":\"%s\"", FIRMWARE_VERSION);
    if (WiFi.status() == WL_CONNECTED) {
        pos += snprintf(buf + pos, sizeof(buf) - pos, ",\"wifi_rssi\":%d", WiFi.RSSI());
    }
    if (pos < (int)sizeof(buf) - 1) {
        buf[pos++] = '}';
        buf[pos] = '\0';
    }
    return String(buf);
}

bool wifi_send_heartbeat() {
    const String body = buildHeartbeatBody();
    Serial.printf("[HTTP] Heartbeat body: %s\n", body.c_str());

    const int maxAttempts = 5;
    unsigned long backoffMs[] = {500, 1000, 2000, 3000, 4000};
    bool ok = false;
    for (int attempt = 1; attempt <= maxAttempts; ++attempt) {
        if (!waitForWifiReady(5000)) {
            Serial.printf("[HTTP] Heartbeat attempt %d/%d skipped: WiFi not ready\n", attempt, maxAttempts);
        } else {
            Serial.printf("[HTTP] Heartbeat attempt %d/%d -> %s\n", attempt, maxAttempts, (backend_url + String("/api/v1/heartbeat")).c_str());
            Serial.printf("[HTTP] WiFi.status=%d, IP=%s\n", WiFi.status(), WiFi.localIP().toString().c_str());
            int code = http_post("/api/v1/heartbeat", body);
            ok = httpOk(code);
            Serial.printf("[HTTP] Heartbeat result code: %d\n", code);
            if (ok) break;
        }
        if (attempt < maxAttempts) delay(backoffMs[attempt - 1]);
    }

    lastHeartbeat = millis();
    if (!ok) {
        Serial.println("[HTTP] Heartbeat: all attempts failed");
    }
    return ok;
}

void wifi_send_uart_data(const String &hex_data) {
    String body = "{\"board_id\":\"" + board_id + "\"";
    if (board_uid.length() > 0) body += ",\"uid\":\"" + board_uid + "\"";
    body += ",\"raw_hex\":\"" + hex_data + "\",\"direction\":\"RX\"}";
    http_post("/api/v1/data/uart", body);
}

void wifi_send_temperature(float temp_celsius) {
    String body = "{\"board_id\":\"" + board_id + "\"";
    if (board_uid.length() > 0) body += ",\"uid\":\"" + board_uid + "\"";
    body += ",\"value_celsius\":" + String(temp_celsius, 2) + "}";
    http_post("/api/v1/data/temperature", body);
}
