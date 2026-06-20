#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "nvs_flash.h"
#include "main.h"

static const char *TAG = "wifi";

static EventGroupHandle_t wifi_event_group;
static const int WIFI_CONNECTED_BIT = BIT0;
static char board_id[32] = {0};

static void event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        esp_wifi_connect();
        xEventGroupClearBits(wifi_event_group, WIFI_CONNECTED_BIT);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

void wifi_init(void) {
    wifi_event_group = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, &instance_got_ip));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());

    uint8_t mac[6];
    esp_wifi_get_mac(WIFI_IF_STA, mac);
    snprintf(board_id, sizeof(board_id), "esp32c3_%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "Board ID: %s", board_id);
}

void wifi_connect(const char *ssid, const char *password) {
    wifi_config_t wifi_config = {
        .sta = {
            .threshold = {.authmode = WIFI_AUTH_WPA2_PSK},
        },
    };
    strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char *)wifi_config.sta.password, password, sizeof(wifi_config.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_LOGI(TAG, "Connecting to WiFi SSID: %s", ssid);

    xEventGroupWaitBits(wifi_event_group, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
    ESP_LOGI(TAG, "WiFi connected");

    wifi_send_heartbeat();
}

static esp_err_t http_post(const char *path, const char *body) {
    char url[256];
    snprintf(url, sizeof(url), "%s%s", BACKEND_URL, path);

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 5000,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "HTTP POST %s: %d", path, esp_http_client_get_status_code(client));
    } else {
        ESP_LOGW(TAG, "HTTP POST %s failed: %s", path, esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    return err;
}

void wifi_send_heartbeat(void) {
    char body[128];
    snprintf(body, sizeof(body), "{\"board_id\":\"%s\"}", board_id);
    http_post("/api/v1/heartbeat", body);
}

void wifi_send_uart_data(const char *hex_data, int len) {
    char body[1024];
    snprintf(body, sizeof(body), "{\"board_id\":\"%s\",\"raw_hex\":\"%s\",\"direction\":\"RX\"}", board_id, hex_data);
    http_post("/api/v1/data/uart", body);
}

void wifi_send_temperature(float temp_celsius) {
    char body[256];
    snprintf(body, sizeof(body), "{\"board_id\":\"%s\",\"value_celsius\":%.2f}", board_id, temp_celsius);
    http_post("/api/v1/data/temperature", body);
}
