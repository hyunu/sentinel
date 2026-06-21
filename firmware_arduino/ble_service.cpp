#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include "ble_service.h"
#include "config.h"

static BLEServer *pServer = nullptr;
static BLECharacteristic *pUartChar = nullptr;
static BLECharacteristic *pWifiSsidChar = nullptr;
static BLECharacteristic *pWifiPassChar = nullptr;
static bool deviceConnected = false;

extern void on_wifi_credentials_received(const String &ssid, const String &password);

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

class WifiSsidCallback : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *c) override {
        String value = c->getValue();
        if (value.length() > 0) {
            Serial.printf("[BLE] WiFi SSID received: %s\n", value.c_str());
        }
    }
};

class WifiPassCallback : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *c) override {
        String ssid = pWifiSsidChar->getValue();
        String password = c->getValue();
        if (ssid.length() > 0 && password.length() > 0) {
            Serial.printf("[BLE] WiFi credentials received. Connecting to: %s\n", ssid.c_str());
            on_wifi_credentials_received(ssid, password);
        }
    }
};

void ble_init() {
    BLEDevice::init(BLE_DEVICE_NAME);
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());

    BLEService *pService = pServer->createService(BLEUUID(UART_SERVICE_UUID));

    pUartChar = pService->createCharacteristic(
        BLEUUID(UART_DATA_CHAR_UUID),
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
    );
    pUartChar->addDescriptor(new BLE2902());

    pWifiSsidChar = pService->createCharacteristic(
        BLEUUID(WIFI_SSID_CHAR_UUID),
        BLECharacteristic::PROPERTY_WRITE
    );
    pWifiSsidChar->setCallbacks(new WifiSsidCallback());

    pWifiPassChar = pService->createCharacteristic(
        BLEUUID(WIFI_PASS_CHAR_UUID),
        BLECharacteristic::PROPERTY_WRITE
    );
    pWifiPassChar->setCallbacks(new WifiPassCallback());

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
    if (!deviceConnected || !pUartChar) return;
    pUartChar->setValue(hex_str);
    pUartChar->notify();
}
