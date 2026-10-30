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
#include "display_manager.h"
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "logger.h"

static unsigned long lastHeartbeat = 0;
static unsigned long lastTemp = 0;

struct CapturedFrame {
    uint32_t capturedTickMs;
    int64_t capturedEpochMs;
    char hex[260];
};

static QueueHandle_t capturedFrameQueue = nullptr;

static void uart_capture_task(void *) {
    for (;;) {
        uart_sniffer_loop();
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

// Called from the high-priority UART capture task. Only queue the frame here;
// HTTP and BLE work stays in loop() so a slow network cannot make a burst of
// frames look like they arrived at the same instant.
void on_frame_received(const uint8_t *data, int len) {
    CapturedFrame frame{};
    frame.capturedTickMs = millis();
    frame.capturedEpochMs = wifi_current_epoch_ms();
    int pos = 0;
    for (int i = 0; i < len && pos < (int)sizeof(frame.hex) - 3; i++) {
        pos += snprintf(frame.hex + pos, sizeof(frame.hex) - pos, "%02X", data[i]);
    }
    frame.hex[pos] = 0;
    if (capturedFrameQueue != nullptr) {
        if (xQueueSend(capturedFrameQueue, &frame, 0) != pdTRUE) {
            static uint32_t dropped;
            if ((++dropped % 100) == 1) {
                AppLog.printf("[UART] capture queue full/drop=%lu\n",
                              (unsigned long)dropped);
            }
        }
    }
}

// Called from ble_service when WiFi credentials arrive
void on_wifi_credentials_received(const String &ssid, const String &password) {
    wifi_connect(ssid, password);
}

void setup() {
    AppLog.begin(115200);
    AppLog.printf("[SYS] reset_reason=%d\n", (int)esp_reset_reason());
    AppLog.println();
    AppLog.println("=== Sentinel UART Monitor ===");
    AppLog.printf("Monitor UART: %d bps on GPIO TX:%d RX:%d\n",
                  UART_BAUD_RATE, UART_MONITOR_TX, UART_MONITOR_RX);

    uart_sniffer_init();
    capturedFrameQueue = xQueueCreate(256, sizeof(CapturedFrame));
    BaseType_t uartTaskCreated = xTaskCreate(
        uart_capture_task, "uart_capture", 4096, nullptr, 10, nullptr);
    AppLog.printf("[UART] capture queue=%p task=%d\n",
                  capturedFrameQueue, (int)uartTaskCreated);
    display_init();
    // wifi_init must run before ble_init so WiFi.macAddress() is valid for
    // the BLE MAC characteristic (6e400004).
    wifi_init();
    ble_init();
    wifi_startup();

    lastHeartbeat = millis();
    lastTemp = millis();

    AppLog.println("System ready.");
}

void loop() {
    // Move captured frames out of the UART task without doing network I/O
    // on that task. Timestamps were recorded at UART frame completion.
    CapturedFrame frame;
    while (capturedFrameQueue != nullptr &&
           xQueueReceive(capturedFrameQueue, &frame, 0) == pdTRUE) {
        String hex(frame.hex);
#if ENABLE_TEST_SENSOR_DATA
        wifi_send_uart_data_at(hex, frame.capturedTickMs, frame.capturedEpochMs);
        ble_send_uart_data(hex);
#endif
    }

    // Handle WiFi connection state
    wifi_loop();

    // Flush deferred BLE log history requests.
    ble_loop();

    display_update(wifi_get_uid(), wifi_is_connected(), ble_is_server_registered());

    unsigned long now = millis();

    // Periodic heartbeat
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = now;
        if (wifi_is_connected()) {
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

#if ENABLE_TEST_SENSOR_DATA
    // Periodic temperature
    if (now - lastTemp >= TEMP_INTERVAL_MS) {
        lastTemp = now;
        if (wifi_is_connected()) {
            float t = temp_sensor_read();
            wifi_send_temperature(t);
        }
    }
#else
    (void)lastTemp;
#endif
}
