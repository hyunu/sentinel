#ifndef BLE_SERVICE_H
#define BLE_SERVICE_H

#include <Arduino.h>

void ble_init();
void ble_send_uart_data(const String &hex_str);
void ble_set_uid(const String &uid);
void ble_set_wifi_connected(bool connected);
void ble_set_server_registered(bool registered);
void ble_refresh_advertising();

#endif
