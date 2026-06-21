#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "main.h"

static const char *TAG = "uart_sniffer";
static QueueHandle_t uart_queue;

#define FRAME_START 0xAA
#define FRAME_END   0xBB

static uint8_t frame_buf[1024];
static int frame_pos = 0;
static int frame_expected_len = 0;

static void send_frame(const uint8_t *data, int len) {
    char hex[2048];
    char ascii[256];
    int hex_pos = 0, ascii_pos = 0;

    for (int i = 0; i < len && i < 128; i++) {
        hex_pos += sprintf(hex + hex_pos, "%02X", data[i]);
        ascii[ascii_pos++] = (data[i] >= 32 && data[i] <= 126) ? data[i] : '.';
    }
    ascii[ascii_pos] = 0;

    ESP_LOGI(TAG, "FRAME [%d bytes]: %s | %s", len, hex, ascii);

    wifi_send_uart_data(hex, len);
    ble_send_uart_data(hex, len);
}

static void process_byte(uint8_t b) {
    if (frame_pos == 0) {
        if (b == FRAME_START) {
            frame_buf[0] = b;
            frame_pos = 1;
            frame_expected_len = 0;
        }
        return;
    }

    frame_buf[frame_pos++] = b;

    if (frame_pos == 3 && frame_expected_len == 0) {
        frame_expected_len = (frame_buf[1] << 8) | frame_buf[2];
    }

    if (b == FRAME_END && frame_pos > 4) {
        send_frame(frame_buf, frame_pos);
        frame_pos = 0;
        frame_expected_len = 0;
        return;
    }

    if (frame_expected_len > 0 && frame_pos >= frame_expected_len + 1) {
        if (b == FRAME_END) {
            send_frame(frame_buf, frame_pos);
        }
        frame_pos = 0;
        frame_expected_len = 0;
        return;
    }

    if (frame_pos >= (int)sizeof(frame_buf)) {
        frame_pos = 0;
        frame_expected_len = 0;
    }
}

static void uart_event_task(void *pv) {
    uart_event_t event;
    uint8_t data[256];

    while (1) {
        if (xQueueReceive(uart_queue, &event, portMAX_DELAY)) {
            switch (event.type) {
                case UART_DATA:
                    bzero(data, sizeof(data));
                    int len = uart_read_bytes(UART_MONITOR_PORT, data, event.size, pdMS_TO_TICKS(100));
                    for (int i = 0; i < len; i++) {
                        process_byte(data[i]);
                    }
                    break;

                case UART_FIFO_OVF:
                case UART_BUFFER_FULL:
                    uart_flush_input(UART_MONITOR_PORT);
                    xQueueReset(uart_queue);
                    frame_pos = 0;
                    frame_expected_len = 0;
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
