#include <NimBLEDevice.h>
#include <vector>

#include "ble_service.h"
#include "config.h"
#include "wifi_manager.h"

static NimBLEServer *pServer = nullptr;
static NimBLECharacteristic *pUartNotifyChar = nullptr;
static NimBLECharacteristic *pUartWriteChar = nullptr;
static bool deviceConnected = false;

static uint8_t gStatusFlags = 0;
static char gUidStr[8] = {0};
static bool gServerRegistered = false;

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

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* srv, NimBLEConnInfo& connInfo) override {
        (void)srv; (void)connInfo;
        deviceConnected = true;
        Serial.println("[BLE] Connected");
    }
    void onDisconnect(NimBLEServer* srv, NimBLEConnInfo& connInfo, int reason) override {
        (void)srv; (void)connInfo; (void)reason;
        deviceConnected = false;
        Serial.println("[BLE] Disconnected");
        ble_refresh_advertising();
    }
};

class UartWriteCallback : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        std::string val = c->getValue();
        String value = String(val.c_str());
        if (value.length() == 0) return;
        Serial.printf("[BLE] Received write payload: %s\n", value.c_str());

        String ssid = _extract_json_field(value, "ssid");
        String password = _extract_json_field(value, "password");
        String serverUrl = _extract_json_field(value, "serverUrl");
        if (serverUrl.length() == 0) {
            serverUrl = _extract_json_field(value, "url");
        }
        String uniqueId = _extract_json_field(value, "uniqueId");

        if (serverUrl.length() > 0) {
            wifi_set_server_url(serverUrl);
        }
        if (uniqueId.length() > 0) {
            wifi_set_uid(uniqueId);
        }

        if (ssid.length() > 0 && password.length() > 0) {
            Serial.printf("[BLE] WiFi credentials received. Connecting to: %s\n", ssid.c_str());
            on_wifi_credentials_received(ssid, password);
        } else {
            Serial.printf("[BLE] WiFi credentials not found in payload\n");
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
    adv->start();

    Serial.printf("[BLE] Advertising name=%s flags=0x%02X uid=%s\n", name, gStatusFlags, gUidStr);
}

void ble_set_uid(const String &uid) {
    _pad_uid(uid, gUidStr, sizeof(gUidStr));
    gStatusFlags &= ~BLE_FLAG_SVR;
    ble_refresh_advertising();
}

void ble_set_wifi_connected(bool connected) {
    (void)connected;
    ble_refresh_advertising();
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

    pService->start();

    NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(NimBLEUUID(UART_SERVICE_UUID));
    ble_refresh_advertising();

    Serial.printf("[BLE] NimBLE Initialized. Name: %s\n", BLE_DEVICE_NAME);
}

void ble_send_uart_data(const String &hex_str) {
    Serial.println(hex_str);
    if (!pUartNotifyChar || !deviceConnected) return;
    pUartNotifyChar->setValue(hex_str.c_str());
    pUartNotifyChar->notify();
}
