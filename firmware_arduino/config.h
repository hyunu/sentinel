#ifndef CONFIG_H
#define CONFIG_H

#define UART_BAUD_RATE      19200
#define UART_MONITOR_RX     20   // ESP32-C3 GPIO20 (sniffer RX = target TX)
#define UART_MONITOR_TX     21   // ESP32-C3 GPIO21 (sniffer TX = target RX)

#define HEARTBEAT_INTERVAL_MS  30000
#define TEMP_INTERVAL_MS       10000

#define BACKEND_URL             "http://192.168.1.100:5050"
#define BOARD_ID_PREFIX         "sentinel"

#define BLE_DEVICE_NAME         "Sentinel-UART"
#define BLE_MANUFACTURER_ID     0x02E5

#define UART_SERVICE_UUID       "0000ffe0-0000-1000-8000-00805f9b34fb"
#define UART_DATA_CHAR_UUID     "0000ffe1-0000-1000-8000-00805f9b34fb"
#define WIFI_SSID_CHAR_UUID     "0000ffe2-0000-1000-8000-00805f9b34fb"
#define WIFI_PASS_CHAR_UUID     "0000ffe3-0000-1000-8000-00805f9b34fb"

#define FRAME_START_BYTE        0xAA
#define FRAME_END_BYTE          0xBB

#endif
