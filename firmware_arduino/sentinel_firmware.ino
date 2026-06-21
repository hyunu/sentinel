/*
 * Sentinel UART Monitor — ESP32-C3
 *
 * Sniffs UART traffic (19200 bps), detects AA...BB protocol frames,
 * and streams data over BLE notify + WiFi HTTP.
 *
 * Board: ESP32-C3 Dev Module
 * Arduino IDE: Tools → Board → ESP32C3 Dev Module
 */

#include "config.h"
#include "uart_sniffer.h"
#include "ble_service.h"
#include "wifi_manager.h"
#include "temp_sensor.h"

static unsigned long lastHeartbeat = 0;
static unsigned long lastTemp = 0;
static String frameHexBuffer;

// Called from uart_sniffer when a complete frame is received
void on_frame_received(const uint8_t *data, int len) {
    char hex_str[2048];
    int pos = 0;
    for (int i = 0; i < len && pos < (int)sizeof(hex_str) - 3; i++) {
        pos += snprintf(hex_str + pos, sizeof(hex_str) - pos, "%02X", data[i]);
    }
    hex_str[pos] = 0;
    String hex = String(hex_str);

    Serial.printf("[FRAME] %d bytes: %s\n", len, hex_str);

    // Send over BLE notify
    ble_send_uart_data(hex);

    // Send over WiFi HTTP
    wifi_send_uart_data(hex);
}

// Called from ble_service when WiFi credentials arrive
void on_wifi_credentials_received(const String &ssid, const String &password) {
    wifi_connect(ssid, password);
}

void setup() {
    Serial.begin(115200);
    Serial.println();
    Serial.println("=== Sentinel UART Monitor ===");
    Serial.printf("Monitor UART: %d bps on GPIO TX:%d RX:%d\n",
                  UART_BAUD_RATE, UART_MONITOR_TX, UART_MONITOR_RX);

    uart_sniffer_init();
    wifi_init();
    ble_init();

    lastHeartbeat = millis();
    lastTemp = millis();

    Serial.println("System ready.");
}

void loop() {
    // Process incoming UART bytes (frame detection)
    uart_sniffer_loop();

    // Handle WiFi connection state
    wifi_loop();

    unsigned long now = millis();

    // Periodic heartbeat
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = now;
        if (wifi_is_connected()) {
            wifi_send_heartbeat();
        }
    }

    // Periodic temperature
    if (now - lastTemp >= TEMP_INTERVAL_MS) {
        lastTemp = now;
        if (wifi_is_connected()) {
            float t = temp_sensor_read();
            wifi_send_temperature(t);
        }
    }
}
