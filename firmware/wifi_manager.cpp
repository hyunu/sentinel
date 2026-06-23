#include <WiFi.h>
#include <HTTPClient.h>

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
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.setSleep(false);
}

void wifi_connect(const String &ssid, const String &password) {
    if (connecting) return;
    connecting = true;
    pendingInitialHeartbeat = false;
    wifiConnectedAt = 0;

    Serial.printf("[WiFi] Connecting to %s...\n", ssid.c_str());
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
            ble_send_uart_data(String("EVENT:HEARTBEAT_OK"));
        } else {
            ble_send_uart_data(String("EVENT:HEARTBEAT_FAILED"));
        }
    }
}

void wifi_set_server_url(const String &url) {
    if (url.length() == 0) return;
    backend_url = url;
    Serial.printf("[WiFi] Backend URL updated: %s\n", backend_url.c_str());
}

void wifi_set_uid(const String &uid) {
    if (uid.length() == 0) return;
    board_uid = uid;
    Serial.printf("[WiFi] UID updated: %s\n", board_uid.c_str());
    // update BLE advertised name to include UID: Sentinel-<UID>
    String uid_padded = board_uid;
    while (uid_padded.length() < 4) {
        uid_padded = String("0") + uid_padded;
    }
    String advertised = String("Sentinel-") + uid_padded;
    ble_update_name(advertised);
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

bool wifi_send_heartbeat() {
    String body = "{\"board_id\":\"" + board_id + "\"";
    if (board_uid.length() > 0) {
        body += ",\"uid\":\"" + board_uid + "\"";
    }
    body += "}";

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
