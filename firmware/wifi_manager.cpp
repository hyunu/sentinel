#include <WiFi.h>
#include <HTTPClient.h>

#include "wifi_manager.h"
#include "config.h"
#include "ble_service.h"

static String board_id;
static unsigned long lastHeartbeat = 0;
static bool connecting = false;

static String backend_url = String(BACKEND_URL);
static String board_uid = String("");

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
}

void wifi_connect(const String &ssid, const String &password) {
    if (connecting) return;
    connecting = true;

    Serial.printf("[WiFi] Connecting to %s...\n", ssid.c_str());
    WiFi.begin(ssid.c_str(), password.c_str());
}

bool wifi_is_connected() {
    return WiFi.status() == WL_CONNECTED;
}

void wifi_loop() {
    if (connecting && WiFi.status() == WL_CONNECTED) {
        connecting = false;
        Serial.printf("[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
        // notify app via BLE and send initial heartbeat
        ble_send_uart_data(String("EVENT:WIFI_CONNECTED"));
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
    String advertised = String("Sentinel-") + board_uid;
    ble_update_name(advertised);
}

static bool http_post(const String &path, const String &body) {
    if (!wifi_is_connected()) return false;

    HTTPClient http;
    String url = backend_url + path;

    http.begin(url);
    http.addHeader("Content-Type", "application/json");

    int code = http.POST(body);
    bool ok = (code > 0);
    if (ok) {
        Serial.printf("[HTTP] POST %s: %d\n", path.c_str(), code);
    } else {
        Serial.printf("[HTTP] POST %s failed: %d\n", path.c_str(), code);
    }

    http.end();
    return ok;
}

bool wifi_send_heartbeat() {
    String body = "{\"board_id\":\"" + board_id + "\"";
    if (board_uid.length() > 0) {
        body += ",\"uid\":\"" + board_uid + "\"";
    }
    body += "}";
    bool ok = http_post("/api/v1/heartbeat", body);
    lastHeartbeat = millis();
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
