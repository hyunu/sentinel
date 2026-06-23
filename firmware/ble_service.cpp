#include <NimBLEDevice.h>
#include <vector>

#include "ble_service.h"
#include "config.h"
#include "wifi_manager.h"

static NimBLEServer *pServer = nullptr;
static NimBLECharacteristic *pUartNotifyChar = nullptr;
static NimBLECharacteristic *pUartWriteChar = nullptr;
static bool deviceConnected = false;

extern void on_wifi_credentials_received(const String &ssid, const String &password);

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
        NimBLEDevice::getAdvertising()->start();
    }
};

class UartWriteCallback : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        std::string val = c->getValue();
        String value = String(val.c_str());
        if (value.length() == 0) return;
        Serial.printf("[BLE] Received write payload: %s\n", value.c_str());

        // Try to extract ssid/password from JSON payload
        String ssid = _extract_json_field(value, "ssid");
        String password = _extract_json_field(value, "password");
        String serverUrl = _extract_json_field(value, "serverUrl");
        if (serverUrl.length() == 0) {
            // try alternate key 'url'
            serverUrl = _extract_json_field(value, "url");
        }
        String uniqueId = _extract_json_field(value, "uniqueId");
        // update backend URL / UID if present
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

void ble_init() {
    NimBLEDevice::init(BLE_DEVICE_NAME);
    pServer = NimBLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());

    NimBLEService *pService = pServer->createService(NimBLEUUID(UART_SERVICE_UUID));

    // Notify characteristic (board -> app)
    pUartNotifyChar = pService->createCharacteristic(
        NimBLEUUID(UART_NOTIFY_CHAR_UUID),
        NIMBLE_PROPERTY::NOTIFY
    );
    pUartNotifyChar->addDescriptor(new NimBLE2902());

    // Write characteristic (app -> board)
    pUartWriteChar = pService->createCharacteristic(
        NimBLEUUID(UART_WRITE_CHAR_UUID),
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pUartWriteChar->setCallbacks(new UartWriteCallback());

    pService->start();

    NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(NimBLEUUID(UART_SERVICE_UUID));
    pAdvertising->start();

    Serial.printf("[BLE] NimBLE Initialized. Name: %s\n", BLE_DEVICE_NAME);
}

void ble_send_uart_data(const String &hex_str) {
    if (!deviceConnected || !pUartNotifyChar) return;
    pUartNotifyChar->setValue(hex_str.c_str());
    pUartNotifyChar->notify();
}

void ble_update_name(const String &name) {
    if (name.length() == 0) return;
    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    // stop to ensure controller picks up changes
    adv->stop();

    // manufacturer data: company id (little endian) + flags(0) + ASCII UID (if present)
    const uint16_t company = (uint16_t)BLE_MANUFACTURER_ID;
    String uid_str = "";
    int dash = name.indexOf('-');
    if (dash >= 0 && dash + 1 < (int)name.length()) uid_str = name.substring(dash + 1);
    size_t uidLen = uid_str.length();
    size_t mfgLen = 2 + 1 + uidLen; // company_lo, company_hi, flags, [uid...]
    std::vector<uint8_t> mfg(mfgLen);
    mfg[0] = (uint8_t)(company & 0xFF);
    mfg[1] = (uint8_t)(company >> 8);
    mfg[2] = 0x00; // status flags (reserved)
    for (size_t i = 0; i < uidLen; ++i) mfg[3 + i] = (uint8_t)uid_str[i];
    adv->setManufacturerData(mfg.data(), (int)mfgLen);

    // update GAP device name so mobile OSes display it
    NimBLEDevice::setDeviceName(name.c_str());

    adv->start();
    Serial.printf("[BLE] Updated advertised name (nimble): %s\n", name.c_str());
}
