#ifndef CONFIG_H
#define CONFIG_H

#define UART_BAUD_RATE      19200
#define UART_MONITOR_RX     20   // ESP32-C3 GPIO20 (sniffer RX = target TX)
#define UART_MONITOR_TX     21   // ESP32-C3 GPIO21 (sniffer TX = target RX)

#define HEARTBEAT_INTERVAL_MS  30000
#define TEMP_INTERVAL_MS       10000

#define BACKEND_URL             "http://192.168.0.9:5050"
#define BOARD_ID_PREFIX         "sentinel"
#define FIRMWARE_VERSION        "1.0.0"

#define BLE_DEVICE_NAME         "Sentinel"
#define BLE_MANUFACTURER_ID     0x02E5
#define BLE_FLAG_SVR            0x02  // server heartbeat OK
#define BLE_FLAG_WIFI           0x04  // WiFi connected
#define BLE_FLAG_CFG            0x08  // UID / config received

// Use Nordic UART Service (NUS) UUIDs to match mobile nexio-style onboarding
#define UART_SERVICE_UUID       "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_NOTIFY_CHAR_UUID   "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_WRITE_CHAR_UUID    "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
#define UART_MAC_CHAR_UUID      "6e400004-b5a3-f393-e0a9-e50e24dcca9e"

// legacy single-characteristic names kept for compatibility (not used)
#define UART_DATA_CHAR_UUID     UART_NOTIFY_CHAR_UUID
#define WIFI_SSID_CHAR_UUID     UART_WRITE_CHAR_UUID
#define WIFI_PASS_CHAR_UUID     UART_WRITE_CHAR_UUID

#define FRAME_START_BYTE        0xAA
#define FRAME_END_BYTE          0xBB

// SSD1306 OLED display (I2C) — same pins as nexio firmware (72×40)
#define OLED_SDA                5
#define OLED_SCL                6
#define OLED_ADDR               0x3C
#define OLED_WIDTH              72
#define OLED_HEIGHT             40

#endif
