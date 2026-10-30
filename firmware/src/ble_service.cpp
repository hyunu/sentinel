#include <NimBLEDevice.h>
#include <WiFi.h>
#include <string>
#include <esp_mac.h>
#include <cstring>
#include <vector>
#include <deque>

#include "ble_service.h"
#include "config.h"
#include "logger.h"
#include "uart_sniffer.h"
#include "wifi_manager.h"

static NimBLEServer *pServer = nullptr;
static NimBLECharacteristic *pUartNotifyChar = nullptr;
static NimBLECharacteristic *pUartWriteChar = nullptr;
static NimBLECharacteristic *pMacChar = nullptr;
static NimBLECharacteristic *pLogChar = nullptr;
static bool deviceConnected = false;

static uint8_t gStatusFlags = 0;
static char gUidStr[8] = {0};
static bool gServerRegistered = false;

static const size_t kLogHistoryMax = 120;
static std::deque<String> gLogHistory;
static volatile bool gLogHistoryRequested = false;

static void notify_log_line(const String &line) {
    if (!pLogChar || !deviceConnected) return;

    const String payload = line + "\n";
    const size_t chunkSize = 180;
    for (size_t offset = 0; offset < payload.length(); offset += chunkSize) {
        size_t end = offset + chunkSize;
        if (end > payload.length()) end = payload.length();
        const String chunk = payload.substring(offset, end);
        pLogChar->setValue(reinterpret_cast<const uint8_t *>(chunk.c_str()), chunk.length());
        pLogChar->notify();
        delay(2);
    }
}

void ble_send_log(const String &text) {
    if (text.length() == 0) return;

    String normalized = text;
    normalized.replace("\r", "");
    int start = 0;
    while (start <= (int)normalized.length()) {
        const int end = normalized.indexOf('\n', start);
        const String line = end < 0
            ? normalized.substring(start)
            : normalized.substring(start, end);
        if (line.length() > 0) {
            gLogHistory.push_back(line);
            if (gLogHistory.size() > kLogHistoryMax) gLogHistory.pop_front();
            notify_log_line(line);
        }
        if (end < 0) break;
        start = end + 1;
    }
}

void ble_loop() {
    if (!gLogHistoryRequested || !deviceConnected) return;
    gLogHistoryRequested = false;
    const std::deque<String> history = gLogHistory;
    for (const auto &line : history) {
        notify_log_line(line);
    }
}

class LogCharCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        std::string raw = pCharacteristic->getValue();
        String command = String(raw.c_str());
        command.trim();
        if (command == "HISTORY") {
            // Notifications cannot be queued reliably from the BLE write
            // callback. Defer the history burst to the main loop.
            gLogHistoryRequested = true;
        }
    }
};

extern void on_wifi_credentials_received(const String &ssid, const String &password);

static void _pad_uid(const String &uid, char *out, size_t outLen) {
    if (uid.length() == 0) {
        out[0] = '\0';
        return;
    }
    bool isDigit = true;
    for (unsigned i = 0; i < uid.length(); ++i) {
        if (uid[i] < '0' || uid[i] > '9') { isDigit = false; break; }
    }
    if (isDigit) {
        snprintf(out, outLen, "%04d", uid.toInt());
    } else {
        strncpy(out, uid.c_str(), outLen - 1);
        out[outLen - 1] = '\0';
    }
}

static void _apply_status_flags() {
    gStatusFlags = 0;
    if (gUidStr[0] != '\0') gStatusFlags |= BLE_FLAG_CFG;
    if (wifi_is_connected()) gStatusFlags |= BLE_FLAG_WIFI;
    if (gServerRegistered) gStatusFlags |= BLE_FLAG_SVR;
}

// Simple JSON field extractor (very small, no external JSON lib)
static String _extract_json_field(const String &json, const char *key) {
    String pattern = String("\"") + String(key) + String("\":\"");
    int idx = json.indexOf(pattern);
    if (idx < 0) return String("");
    idx += pattern.length();
    int end = json.indexOf("\"", idx);
    if (end < 0) return String("");
    return json.substring(idx, end);
}

// Numeric JSON field extractor (for baudRate and similar values).
static long _extract_json_number(const String &json, const char *key, long fallback) {
    String pattern = String("\"") + String(key) + String("\":");
    int idx = json.indexOf(pattern);
    if (idx < 0) return fallback;
    idx += pattern.length();
    while (idx < (int)json.length() && (json[idx] == ' ' || json[idx] == '\t')) {
        idx++;
    }
    int end = idx;
    if (end < (int)json.length() && json[end] == '-') end++;
    while (end < (int)json.length() && json[end] >= '0' && json[end] <= '9') {
        end++;
    }
    if (end == idx) return fallback;
    return json.substring(idx, end).toInt();
}

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
        (void)pServer; (void)connInfo;
        deviceConnected = true;
        AppLog.println("[BLE] Connected");
    }
    void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
        (void)pServer; (void)connInfo; (void)reason;
        deviceConnected = false;
        AppLog.println("[BLE] Disconnected");
        ble_refresh_advertising();
    }
};

class UartWriteCallback : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        std::string val = pCharacteristic->getValue();
        String value = String(val.c_str());
        if (value.length() == 0) return;
        AppLog.printf("[BLE] Received write payload (%u bytes)\n", (unsigned)value.length());

        String ssid = _extract_json_field(value, "ssid");
        String password = _extract_json_field(value, "password");
        String serverUrl = _extract_json_field(value, "serverUrl");
        if (serverUrl.length() == 0) {
            serverUrl = _extract_json_field(value, "url");
        }
        String uniqueId = _extract_json_field(value, "uniqueId");
        long baudRate = _extract_json_number(value, "baudRate", 0);

        if (serverUrl.length() > 0) {
            wifi_set_server_url(serverUrl);
        }
        if (uniqueId.length() > 0) {
            wifi_set_uid(uniqueId);
        }
        if (baudRate > 0) {
            uart_sniffer_set_baud((uint32_t)baudRate);
            ble_send_uart_data(String("EVENT:BAUD_SET"));
        }

        if (ssid.length() > 0 && password.length() > 0) {
            AppLog.printf("[BLE] WiFi credentials received. Connecting to: %s\n", ssid.c_str());
            on_wifi_credentials_received(ssid, password);
        } else {
            AppLog.printf("[BLE] WiFi credentials not found in payload\n");
        }
    }
};

void ble_refresh_advertising() {
    _apply_status_flags();

    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->stop();

    char name[48];
    if (gUidStr[0] != '\0') {
        snprintf(name, sizeof(name), "Sentinel-%s", gUidStr);
    } else {
        strncpy(name, BLE_DEVICE_NAME, sizeof(name) - 1);
        name[sizeof(name) - 1] = '\0';
    }

    const uint16_t company = (uint16_t)BLE_MANUFACTURER_ID;
    const size_t uidLen = strlen(gUidStr);
    const size_t mfgLen = 3 + uidLen;
    std::vector<uint8_t> mfg(mfgLen);
    mfg[0] = (uint8_t)(company & 0xFF);
    mfg[1] = (uint8_t)(company >> 8);
    mfg[2] = gStatusFlags;
    for (size_t i = 0; i < uidLen; ++i) {
        mfg[3 + i] = (uint8_t)gUidStr[i];
    }

    adv->setManufacturerData(mfg.data(), (int)mfgLen);
    NimBLEDevice::setDeviceName(name);
    // The 128-bit service UUID + manufacturer data fill the legacy adv packet,
    // so put the human-readable name in the scan response.
    adv->enableScanResponse(true);
    adv->setName(std::string(name));
    adv->start();

    AppLog.printf("[BLE] Advertising name=%s flags=0x%02X uid=%s\n", name, gStatusFlags, gUidStr);
}

void ble_preload_uid(const String &uid) {
    _pad_uid(uid, gUidStr, sizeof(gUidStr));
}

void ble_set_uid(const String &uid) {
    _pad_uid(uid, gUidStr, sizeof(gUidStr));
    gStatusFlags &= ~BLE_FLAG_SVR;
    ble_refresh_advertising();
}

void ble_set_wifi_mac(const String &mac) {
    if (!pMacChar || mac.length() == 0) return;
    pMacChar->setValue(reinterpret_cast<const uint8_t *>(mac.c_str()), mac.length());
    AppLog.printf("[BLE] WiFi MAC characteristic updated: %s\n", mac.c_str());
}

void ble_set_wifi_connected(bool connected) {
    (void)connected;
    ble_refresh_advertising();
}

bool ble_is_server_registered() {
    return gServerRegistered;
}

void ble_set_server_registered(bool registered) {
    gServerRegistered = registered;
    ble_refresh_advertising();
}

void ble_init() {
    NimBLEDevice::init(BLE_DEVICE_NAME);
    pServer = NimBLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());

    NimBLEService *pService = pServer->createService(NimBLEUUID(UART_SERVICE_UUID));

    pUartNotifyChar = pService->createCharacteristic(
        NimBLEUUID(UART_NOTIFY_CHAR_UUID),
        NIMBLE_PROPERTY::NOTIFY
    );

    pUartWriteChar = pService->createCharacteristic(
        NimBLEUUID(UART_WRITE_CHAR_UUID),
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pUartWriteChar->setCallbacks(new UartWriteCallback());

    pMacChar = pService->createCharacteristic(
        NimBLEUUID(UART_MAC_CHAR_UUID),
        NIMBLE_PROPERTY::READ
    );

    pLogChar = pService->createCharacteristic(
        NimBLEUUID(UART_LOG_CHAR_UUID),
        NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::WRITE
    );
    pLogChar->setCallbacks(new LogCharCallbacks());
    // Read the factory WiFi MAC from eFuse. WiFi.macAddress() can return zeros
    // before the WiFi driver is initialized (ble_init runs before wifi_init).
    char macStr[18];
    {
        uint8_t mac[6];
        esp_read_mac(mac, ESP_MAC_WIFI_STA);
        snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        pMacChar->setValue(reinterpret_cast<const uint8_t *>(macStr), strlen(macStr));
    }

    pService->start();
    // Re-apply after service start so the value is always visible to centrals.
    pMacChar->setValue(reinterpret_cast<const uint8_t *>(macStr), strlen(macStr));

    NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(NimBLEUUID(UART_SERVICE_UUID));
    ble_refresh_advertising();

    AppLog.printf("[BLE] NimBLE Initialized. Name: %s\n", BLE_DEVICE_NAME);
}

void ble_send_uart_data(const String &hex_str) {
    if (!pUartNotifyChar || !deviceConnected) return;

    // Keep each notification below the ATT MTU. The app accumulates chunks
    // until the newline terminator, so a long 129-byte UART frame is not
    // truncated by BLE.
    const String payload = hex_str + "\n";
    const size_t chunkSize = 180;
    for (size_t offset = 0; offset < payload.length(); offset += chunkSize) {
        size_t end = offset + chunkSize;
        if (end > payload.length()) end = payload.length();
        String chunk = payload.substring(offset, end);
        pUartNotifyChar->setValue(chunk.c_str());
        pUartNotifyChar->notify();
        delay(2);
    }
}
