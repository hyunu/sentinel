#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "main.h"

static const char *TAG = "uart_sniffer";
static QueueHandle_t uart_queue;

static void uart_event_task(void *pv) {
    uart_event_t event;
    uint8_t data[256];

    while (1) {
        if (xQueueReceive(uart_queue, &event, portMAX_DELAY)) {
            switch (event.type) {
                case UART_DATA:
                    bzero(data, sizeof(data));
                    int len = uart_read_bytes(UART_MONITOR_PORT, data, event.size, pdMS_TO_TICKS(100));
                    if (len > 0) {
                        char hex[512];
                        char ascii[128];
                        int hex_pos = 0, ascii_pos = 0;

                        for (int i = 0; i < len && i < 64; i++) {
                            hex_pos += sprintf(hex + hex_pos, "%02X", data[i]);
                            ascii[ascii_pos++] = (data[i] >= 32 && data[i] <= 126) ? data[i] : '.';
                        }
                        ascii[ascii_pos] = 0;

                        ESP_LOGI(TAG, "UART RX [%d bytes]: %s | %s", len, hex, ascii);

                        wifi_send_uart_data(hex, len);
                        ble_send_uart_data(hex, len);
                    }
                    break;

                case UART_FIFO_OVF:
                case UART_BUFFER_FULL:
                    uart_flush_input(UART_MONITOR_PORT);
                    xQueueReset(uart_queue);
                    break;

                default:
                    break;
            }
        }
    }
}

void uart_sniffer_init(void) {
    uart_config_t uart_config = {
        .baud_rate = UART_BAUD_RATE,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
    };

    ESP_ERROR_CHECK(uart_param_config(UART_MONITOR_PORT, &uart_config));
    ESP_ERROR_CHECK(uart_set_pin(UART_MONITOR_PORT, UART_TX_GPIO, UART_RX_GPIO, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
    ESP_ERROR_CHECK(uart_driver_install(UART_MONITOR_PORT, 1024, 1024, 10, &uart_queue, 0));

    xTaskCreate(uart_event_task, "uart_event", 4096, NULL, 10, NULL);
    ESP_LOGI(TAG, "UART sniffer initialized on GPIO TX:%d RX:%d at %d bps",
             UART_TX_GPIO, UART_RX_GPIO, UART_BAUD_RATE);
}
