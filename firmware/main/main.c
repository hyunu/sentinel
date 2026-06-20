#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "main.h"
#include "uart_sniffer.h"
#include "ble_service.h"
#include "wifi_app.h"
#include "temp_sensor.h"

static const char *TAG = "sentinel";

static void heartbeat_task(void *pv) {
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS));
        wifi_send_heartbeat();
    }
}

static void temp_task(void *pv) {
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(TEMP_INTERVAL_MS));
        float temp = temp_sensor_read();
        wifi_send_temperature(temp);
    }
}

void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_LOGI(TAG, "Sentinel UART Monitor starting...");

    uart_sniffer_init();

    wifi_init();

    ble_init();

    xTaskCreate(heartbeat_task, "heartbeat", 4096, NULL, 5, NULL);
    xTaskCreate(temp_task, "temp", 4096, NULL, 5, NULL);

    ESP_LOGI(TAG, "System ready. Monitoring UART at %d bps.", UART_BAUD_RATE);
}
