#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include "ble_service.h"
#include "config.h"

static BLEServer *pServer = nullptr;
static BLECharacteristic *pUartNotifyChar = nullptr;
static BLECharacteristic *pUartWriteChar = nullptr;
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

class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer *s) override {
        deviceConnected = true;
        Serial.println("[BLE] Connected");
    }
    void onDisconnect(BLEServer *s) override {
        deviceConnected = false;
        Serial.println("[BLE] Disconnected");
        pServer->getAdvertising()->start();
    }
};

class UartWriteCallback : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *c) override {
        String value = c->getValue();
        if (value.length() == 0) return;
        Serial.printf("[BLE] Received write payload: %s\n", value.c_str());

        // Try to extract ssid/password from JSON payload
        String ssid = _extract_json_field(value, "ssid");
        String password = _extract_json_field(value, "password");
        if (ssid.length() > 0 && password.length() > 0) {
            Serial.printf("[BLE] WiFi credentials received. Connecting to: %s\n", ssid.c_str());
            on_wifi_credentials_received(ssid, password);
        } else {
            Serial.printf("[BLE] WiFi credentials not found in payload\n");
        }
    }
};

void ble_init() {
    BLEDevice::init(BLE_DEVICE_NAME);
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());

    BLEService *pService = pServer->createService(BLEUUID(UART_SERVICE_UUID));

    // Notify characteristic (board -> app)
    pUartNotifyChar = pService->createCharacteristic(
        BLEUUID(UART_NOTIFY_CHAR_UUID),
        BLECharacteristic::PROPERTY_NOTIFY
    );
    pUartNotifyChar->addDescriptor(new BLE2902());

    // Write characteristic (app -> board)
    pUartWriteChar = pService->createCharacteristic(
        BLEUUID(UART_WRITE_CHAR_UUID),
        BLECharacteristic::PROPERTY_WRITE
    );
    pUartWriteChar->setCallbacks(new UartWriteCallback());

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLEUUID(UART_SERVICE_UUID));
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.printf("[BLE] Initialized. Name: %s\n", BLE_DEVICE_NAME);
}

void ble_send_uart_data(const String &hex_str) {
    if (!deviceConnected || !pUartNotifyChar) return;
    pUartNotifyChar->setValue(hex_str);
    pUartNotifyChar->notify();
}
