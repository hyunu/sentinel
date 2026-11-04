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
#include "status_led.h"
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "logger.h"

static unsigned long lastTemp = 0;
static unsigned long lastUartStats = 0;
static unsigned long lastLinkProbeAt = 0;
static unsigned long lastWifiRecoveryAt = 0;
static int linkFailures = 0;
static bool linkWasHealthy = false;

struct CapturedFrame {
    uint32_t capturedTickMs;
    int64_t capturedEpochMs;
    char direction[4];
    // 145-byte captures need 290 hex characters plus a terminator.
    char hex[320];
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
void on_frame_received(const uint8_t *data, int len, const char *direction) {
    CapturedFrame frame{};
    frame.capturedTickMs = millis();
    frame.capturedEpochMs = wifi_current_epoch_ms();
    snprintf(frame.direction, sizeof(frame.direction), "%s",
             direction != nullptr ? direction : "RX");
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
    AppLog.printf("Monitor UART: %d bps dual capture RX:%d TX:%d\n",
                  UART_BAUD_RATE, UART_CAPTURE_RX_PIN,
                  UART_CAPTURE_TX_PIN);

    status_led_init();
    display_init();
    // wifi_init must run before ble_init so WiFi.macAddress() is valid for
    // the BLE MAC characteristic (6e400004).
    wifi_init();
    // Initialize BLE before allocating the UART capture queue and drivers.
    // NimBLE needs a large contiguous heap block on the C3.
    ble_init();
    wifi_startup();

    uart_sniffer_init();
    capturedFrameQueue = xQueueCreate(64, sizeof(CapturedFrame));
    BaseType_t uartTaskCreated = xTaskCreate(
        uart_capture_task, "uart_capture", 4096, nullptr, 10, nullptr);
    AppLog.printf("[UART] capture queue=%p task=%d\n",
                  capturedFrameQueue, (int)uartTaskCreated);

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
        wifi_send_uart_data_at(hex, frame.capturedTickMs,
                               frame.capturedEpochMs, frame.direction);
        ble_send_uart_data(hex);
#endif
    }

    // Handle WiFi connection state
    wifi_loop();

    // Flush deferred BLE log history requests.
    ble_loop();

    display_update(wifi_get_uid(), wifi_is_connected(), ble_is_server_registered());

    unsigned long now = millis();

    if (now - lastUartStats >= 5000) {
        lastUartStats = now;
        uart_sniffer_log_stats();
    }

    // Server link watchdog. Any successful HTTP response (UART batch or
    // heartbeat) keeps the link healthy, so heartbeat is not sent while data
    // uploads are succeeding. Only when responses stop do we probe every
    // second and force a WiFi reconnect / reboot if needed.
    if (wifi_is_connected()) {
        if (wifi_server_link_healthy()) {
            if (!linkWasHealthy) {
                linkWasHealthy = true;
                linkFailures = 0;
                if (wifi_has_board_uid()) ble_set_server_registered(true);
            }
        } else if (now - lastLinkProbeAt >= 1000) {
            lastLinkProbeAt = now;
            const bool ok = wifi_send_heartbeat();
            if (ok) {
                linkWasHealthy = true;
                linkFailures = 0;
                if (wifi_has_board_uid()) ble_set_server_registered(true);
                ble_send_uart_data(String("EVENT:HEARTBEAT_OK"));
            } else {
                linkWasHealthy = false;
                linkFailures++;
                ble_set_server_registered(false);
                if (linkFailures == 1 || (linkFailures % 3) == 0) {
                    ble_send_uart_data(String("EVENT:HEARTBEAT_FAILED"));
                }
                if ((linkFailures % 3) == 0) {
                    wifi_force_reconnect();
                    lastWifiRecoveryAt = now;
                }
                if (linkFailures >= 30) {
                    AppLog.println("[WiFi] Link watchdog restart");
                    delay(100);
                    ESP.restart();
                }
            }
        }
    } else {
        linkWasHealthy = false;
        if (now - lastWifiRecoveryAt >= 10000) {
            lastWifiRecoveryAt = now;
            wifi_force_reconnect();
        }
    }

#if ENABLE_TEST_TEMPERATURE
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
