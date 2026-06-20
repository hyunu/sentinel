#pragma once

#define UART_BAUD_RATE      19200
#define UART_TX_GPIO        21
#define UART_RX_GPIO        20
#define UART_MONITOR_PORT   UART_NUM_1

#define HEARTBEAT_INTERVAL_MS   (30 * 1000)
#define TEMP_INTERVAL_MS        (10 * 1000)

#define BACKEND_URL             "http://192.168.1.100:5050"
#define BOARD_MAC_ADDR_LEN      6

#define BLE_DEVICE_NAME         "Sentinel-UART"
#define BLE_MANUFACTURER_ID     0x02E5

#define UART_DATA_CHAR_UUID    "0000ffe1-0000-1000-8000-00805f9b34fb"
#define WIFI_SSID_CHAR_UUID    "0000ffe2-0000-1000-8000-00805f9b34fb"
#define WIFI_PASS_CHAR_UUID    "0000ffe3-0000-1000-8000-00805f9b34fb"
