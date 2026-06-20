#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"
#include "esp_bt_defs.h"
#include "main.h"

static const char *TAG = "ble";

#define GATTS_TAG "BLE_GATTS"
#define PROFILE_NUM 1
#define PROFILE_APP_IDX 0
#define SERVICE_UUID 0x00FF

static uint8_t uart_data_value[512] = {0};
static uint16_t uart_data_handle;
static uint16_t uart_data_ccc_handle;
static bool notify_enabled = false;

static uint8_t wifi_ssid_value[32] = {0};
static uint16_t wifi_ssid_handle;
static uint8_t wifi_pass_value[64] = {0};
static uint16_t wifi_pass_handle;
static bool wifi_configured = false;

static uint16_t gatts_if;
static uint16_t conn_id;

enum {
    UART_DATA_IDX = 0,
    UART_DATA_VAL_IDX,
    UART_DATA_CCC_IDX,
    WIFI_SSID_VAL_IDX,
    WIFI_PASS_VAL_IDX,
    GATTS_IDX_NUM,
};

static esp_gatts_attr_db_t gatt_db[GATTS_IDX_NUM] = {
    [UART_DATA_IDX] = {
        .attr_control = {.auto_rsp = ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p = (uint8_t *)&(uint16_t){0x2800},
            .perm = ESP_GATT_PERM_READ,
            .max_length = 2,
            .length = 2,
            .value = (uint8_t *)&(uint16_t){SERVICE_UUID},
        },
    },
    [UART_DATA_VAL_IDX] = {
        .attr_control = {.auto_rsp = ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_128,
            .uuid_p = NULL,
            .perm = ESP_GATT_PERM_READ | ESP_GATT_PERM_NOTIFY,
            .max_length = 512,
            .length = 0,
            .value = uart_data_value,
        },
    },
    [UART_DATA_CCC_IDX] = {
        .attr_control = {.auto_rsp = ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_16,
            .uuid_p = (uint8_t *)&(uint16_t){0x2902},
            .perm = ESP_GATT_PERM_READ | ESP_GATT_PERM_WRITE,
            .max_length = 2,
            .length = 0,
            .value = NULL,
        },
    },
    [WIFI_SSID_VAL_IDX] = {
        .attr_control = {.auto_rsp = ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_128,
            .uuid_p = NULL,
            .perm = ESP_GATT_PERM_WRITE,
            .max_length = 32,
            .length = 0,
            .value = wifi_ssid_value,
        },
    },
    [WIFI_PASS_VAL_IDX] = {
        .attr_control = {.auto_rsp = ESP_GATT_AUTO_RSP},
        .att_desc = {
            .uuid_length = ESP_UUID_LEN_128,
            .uuid_p = NULL,
            .perm = ESP_GATT_PERM_WRITE,
            .max_length = 64,
            .length = 0,
            .value = wifi_pass_value,
        },
    },
};

static void gatts_profile_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param) {
    switch (event) {
        case ESP_GATTS_REG_EVT:
            ESP_LOGI(TAG, "GATTS registered, app_id=%d", param->reg.app_id);
            gatts_if = gatts_if;
            esp_ble_gatts_create_attr_tab(gatt_db, gatts_if, GATTS_IDX_NUM, SERVICE_UUID);
            break;

        case ESP_GATTS_CREAT_ATTR_TAB_EVT: {
            for (int i = 0; i < param->add_attr_tab.num_handle; i++) {
                if (i == UART_DATA_VAL_IDX) uart_data_handle = param->add_attr_tab.handles[i];
                if (i == UART_DATA_CCC_IDX) uart_data_ccc_handle = param->add_attr_tab.handles[i];
                if (i == WIFI_SSID_VAL_IDX) wifi_ssid_handle = param->add_attr_tab.handles[i];
                if (i == WIFI_PASS_VAL_IDX) wifi_pass_handle = param->add_attr_tab.handles[i];
            }
            esp_ble_gatts_start_service(param->add_attr_tab.handles[0]);
            break;
        }

        case ESP_GATTS_START_EVT:
            ESP_LOGI(TAG, "Service started");
            esp_ble_gap_set_device_name(BLE_DEVICE_NAME);
            esp_ble_gap_config_adv_data_raw(NULL, 0);
            break;

        case ESP_GATTS_CONNECT_EVT:
            conn_id = param->connect.conn_id;
            ESP_LOGI(TAG, "BLE connected");
            break;

        case ESP_GATTS_DISCONNECT_EVT:
            conn_id = 0;
            notify_enabled = false;
            ESP_LOGI(TAG, "BLE disconnected");
            esp_ble_gap_start_advertising(&(esp_ble_adv_params_t){
                .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
                .adv_type = ADV_TYPE_IND,
                .channel_map = ADV_CHNL_ALL,
                .adv_interval_min = 0x100,
                .adv_interval_max = 0x200,
            });
            break;

        case ESP_GATTS_WRITE_EVT: {
            uint16_t handle = param->write.handle;
            uint16_t len = param->write.len;
            uint8_t *value = param->write.value;

            if (handle == uart_data_ccc_handle && len == 2) {
                notify_enabled = (value[0] == 0x01);
                ESP_LOGI(TAG, "Notify %s", notify_enabled ? "enabled" : "disabled");
            }

            if (handle == wifi_ssid_handle) {
                memset(wifi_ssid_value, 0, sizeof(wifi_ssid_value));
                memcpy(wifi_ssid_value, value, len);
                ESP_LOGI(TAG, "WiFi SSID received: %s", wifi_ssid_value);
            }

            if (handle == wifi_pass_handle) {
                memset(wifi_pass_value, 0, sizeof(wifi_pass_value));
                memcpy(wifi_pass_value, value, len);
                wifi_configured = true;
                ESP_LOGI(TAG, "WiFi credentials configured, connecting...");
                wifi_connect((const char *)wifi_ssid_value, (const char *)wifi_pass_value);
            }
            break;
        }

        default:
            break;
    }
}

static void gatts_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param) {
    if (event == ESP_GATTS_REG_EVT && param->reg.app_id == PROFILE_APP_IDX) {
        gatts_profile_event_handler(event, gatts_if, param);
    }
}

void ble_init(void) {
    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_bt_controller_init(&bt_cfg));
    ESP_ERROR_CHECK(esp_bt_controller_enable(ESP_BT_MODE_BTDM));

    ESP_ERROR_CHECK(esp_bluedroid_init());
    ESP_ERROR_CHECK(esp_bluedroid_enable());

    esp_ble_gatts_register_callback(gatts_event_handler);
    esp_ble_gatts_app_register(PROFILE_APP_IDX);

    esp_ble_gap_config_adv_data_raw(NULL, 0);
    esp_ble_gap_start_advertising(&(esp_ble_adv_params_t){
        .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
        .adv_type = ADV_TYPE_IND,
        .channel_map = ADV_CHNL_ALL,
        .adv_interval_min = 0x100,
        .adv_interval_max = 0x200,
    });

    ESP_LOGI(TAG, "BLE initialized. Name: %s", BLE_DEVICE_NAME);
}

void ble_send_uart_data(const char *hex_data, int len) {
    if (!notify_enabled || !conn_id) return;

    esp_ble_gatts_send_indicate(gatts_if, conn_id, uart_data_handle, len, (uint8_t *)hex_data, false);
}
