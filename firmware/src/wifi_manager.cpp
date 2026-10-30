#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <esp_mac.h>

#include "wifi_manager.h"
#include "config.h"
#include "ble_service.h"
#include "logger.h"

static String board_id;
static unsigned long lastHeartbeat = 0;
static bool connecting = false;
static bool pendingInitialHeartbeat = false;
static unsigned long wifiConnectedAt = 0;
static unsigned long wifiConnectingAt = 0;
static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;

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
    // The WiFi netif is not ready when wifi_init() runs. Reading it through
    // WiFi.macAddress(mac) at that point leaves the buffer undefined, which
    // made board_id change on every reboot. The eFuse STA MAC is stable.
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char buf[32];
    snprintf(buf, sizeof(buf), "%s_%02x%02x%02x%02x%02x%02x",
             BOARD_ID_PREFIX, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return String(buf);
}

void wifi_init() {
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    // WiFi.mode() must precede getBoardId(): before the station interface is
    // initialized WiFi.macAddress() can return a placeholder MAC.
    board_id = getBoardId();
    AppLog.printf("[WiFi] Board ID: %s\n", board_id.c_str());
    AppLog.printf("[WiFi] MAC: %s\n", WiFi.macAddress().c_str());
    WiFi.setAutoReconnect(true);
    WiFi.setSleep(false);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
    // Keep the BLE-readable MAC synchronized with the initialized STA.
    ble_set_wifi_mac(WiFi.macAddress());

    const String storedUid = nvs_load_string("uid");
    if (storedUid.length() > 0) {
        board_uid = storedUid;
        ble_preload_uid(storedUid);
        AppLog.printf("[WiFi] Restored UID: %s\n", board_uid.c_str());
    }

    const String storedUrl = nvs_load_string("url");
    if (storedUrl.length() > 0) {
        backend_url = storedUrl;
        AppLog.printf("[WiFi] Restored backend URL: %s\n", backend_url.c_str());
    }
}

void wifi_startup() {
    const String ssid = nvs_load_string("ssid");
    const String pass = nvs_load_string("pass");
    if (ssid.length() > 0 && pass.length() > 0) {
        AppLog.printf("[WiFi] Auto-connect to stored network: %s\n", ssid.c_str());
        wifi_connect(ssid, pass);
    }
}

void wifi_connect(const String &ssid, const String &password) {
    pendingInitialHeartbeat = false;
    wifiConnectedAt = 0;
    wifiConnectingAt = millis();
    WiFi.setAutoReconnect(false);

    nvs_save_string("ssid", ssid);
    nvs_save_string("pass", password);

    connecting = true;
    AppLog.printf("[WiFi] Connecting to %s...\n", ssid.c_str());
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
        WiFi.setAutoReconnect(true);
        pendingInitialHeartbeat = true;
        wifiConnectedAt = millis();
        // The STA netif may finalize its locally-administered MAC only after
        // association. Keep the BLE-readable MAC in sync with heartbeats.
        ble_set_wifi_mac(WiFi.macAddress());
        AppLog.printf("[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
        ble_set_wifi_connected(true);
        ble_send_uart_data(String("EVENT:WIFI_CONNECTED"));
    }

    if (connecting && millis() - wifiConnectingAt >= WIFI_CONNECT_TIMEOUT_MS) {
        connecting = false;
        pendingInitialHeartbeat = false;
        WiFi.setAutoReconnect(false);
        WiFi.disconnect(false);
        ble_set_wifi_connected(false);
        ble_send_uart_data(String("EVENT:WIFI_FAILED"));
        AppLog.println("[WiFi] Connection timed out; waiting for new onboarding config");
    }

    if (pendingInitialHeartbeat && millis() - wifiConnectedAt >= 2500) {
        pendingInitialHeartbeat = false;
        if (!waitForWifiReady(15000)) {
            AppLog.println("[WiFi] Network not stable before initial heartbeat");
            ble_send_uart_data(String("EVENT:HEARTBEAT_FAILED"));
            return;
        }

        bool ok = wifi_send_heartbeat();
        if (ok && wifi_has_board_uid()) {
            ble_set_server_registered(true);
            ble_send_uart_data(String("EVENT:HEARTBEAT_OK"));
        } else if (!ok) {
            ble_set_server_registered(false);
            ble_send_uart_data(String("EVENT:HEARTBEAT_FAILED"));
        }
    }
}

void wifi_set_server_url(const String &url) {
    if (url.length() == 0) return;
    backend_url = url;
    nvs_save_string("url", url);
    AppLog.printf("[WiFi] Backend URL updated: %s\n", backend_url.c_str());
}

void wifi_set_uid(const String &uid) {
    if (uid.length() == 0) return;
    board_uid = uid;
    nvs_save_string("uid", uid);
    AppLog.printf("[WiFi] UID updated: %s\n", board_uid.c_str());
    ble_set_uid(uid);
}

String wifi_get_uid() {
    return board_uid;
}

bool wifi_has_board_uid() {
    return board_uid.length() > 0;
}

void wifi_clear_board_registration() {
    board_uid = "";
    nvs_save_string("uid", "");
    // A server-side deletion resets the local onboarding state as well.
    // Otherwise the board would auto-connect to the stored AP again after a
    // reboot even though it no longer exists on the server.
    nvs_save_string("ssid", "");
    nvs_save_string("pass", "");
    nvs_save_string("url", "");
    backend_url = String(BACKEND_URL);
    ble_preload_uid("");
    ble_set_uid("");
    ble_set_server_registered(false);
    connecting = false;
    pendingInitialHeartbeat = false;
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(false);
    ble_set_wifi_connected(false);
    AppLog.println("[WiFi] Board registration and WiFi credentials cleared");
}

static String extract_json_string_field(const String &json, const char *key) {
    String pattern = String("\"") + String(key) + String("\":\"");
    int idx = json.indexOf(pattern);
    if (idx < 0) return String("");
    idx += pattern.length();
    int end = json.indexOf("\"", idx);
    if (end < 0) return String("");
    return json.substring(idx, end);
}

static int http_post(const String &path, const String &body, String *responseOut = nullptr) {
    if (!wifi_is_connected() || !hasValidIp()) return -1;

    HTTPClient http;
    String url = backend_url + path;

    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(10000);

    int code = http.POST(body);
    if (code > 0) {
        AppLog.printf("[HTTP] POST %s: %d\n", path.c_str(), code);
        if (responseOut) {
            *responseOut = http.getString();
        }
    } else {
        AppLog.printf("[HTTP] POST %s failed: %d\n", path.c_str(), code);
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
    // Keep onboarding's BLE identity aligned with the board_id used below.
    ble_set_wifi_mac(WiFi.macAddress());
    const String body = buildHeartbeatBody();
    AppLog.printf("[HTTP] Heartbeat body: %s\n", body.c_str());

    const int maxAttempts = 5;
    unsigned long backoffMs[] = {500, 1000, 2000, 3000, 4000};
    bool ok = false;
    for (int attempt = 1; attempt <= maxAttempts; ++attempt) {
        if (!waitForWifiReady(5000)) {
            AppLog.printf("[HTTP] Heartbeat attempt %d/%d skipped: WiFi not ready\n", attempt, maxAttempts);
        } else {
            AppLog.printf("[HTTP] Heartbeat attempt %d/%d -> %s\n", attempt, maxAttempts, (backend_url + String("/api/v1/heartbeat")).c_str());
            AppLog.printf("[HTTP] WiFi.status=%d, IP=%s\n", WiFi.status(), WiFi.localIP().toString().c_str());
            String response;
            int code = http_post("/api/v1/heartbeat", body, &response);
            ok = httpOk(code);
            AppLog.printf("[HTTP] Heartbeat result code: %d\n", code);
            if (ok) {
                const String action = extract_json_string_field(response, "action");
                if (action == "deleted") {
                    wifi_clear_board_registration();
                    ble_send_uart_data(String("EVENT:BOARD_DELETED"));
                    AppLog.println("[HTTP] Server deleted this board — registration cleared");
                }
                break;
            }
            // If the server no longer knows this board (e.g. it was deleted
            // while offline), wipe local onboarding state as well.
            if (code == 404 ||
                (code == 400 &&
                 (response.indexOf("board not found") >= 0 ||
                  response.indexOf("board_id or uid required") >= 0))) {
                wifi_clear_board_registration();
                ble_send_uart_data(String("EVENT:BOARD_DELETED"));
                AppLog.println("[HTTP] Board unknown to server — local onboarding cleared");
                return false;
            }
        }
        if (attempt < maxAttempts) delay(backoffMs[attempt - 1]);
    }

    lastHeartbeat = millis();
    if (!ok) {
        AppLog.println("[HTTP] Heartbeat: all attempts failed");
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
