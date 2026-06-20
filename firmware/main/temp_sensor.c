#include <stdio.h>
#include "esp_log.h"
#include "driver/temp_sensor.h"
#include "temp_sensor.h"

static const char *TAG = "temp";
static bool initialized = false;

float temp_sensor_read(void) {
    if (!initialized) {
        temp_sensor_config_t tsens = TSENS_CONFIG_DEFAULT();
        ESP_ERROR_CHECK(temp_sensor_set_config(&tsens));
        ESP_ERROR_CHECK(temp_sensor_start());
        initialized = true;
    }

    float temp = 0;
    esp_err_t ret = temp_sensor_read_celsius(&temp);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "Failed to read temperature");
        return -1;
    }
    return temp;
}
