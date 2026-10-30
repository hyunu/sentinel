#ifndef BLE_SERVICE_H
#define BLE_SERVICE_H

#include <Arduino.h>

void ble_init();
void ble_send_uart_data(const String &hex_str);
void ble_send_log(const String &text);
void ble_loop();
void ble_preload_uid(const String &uid);
void ble_set_uid(const String &uid);
void ble_set_wifi_mac(const String &mac);
void ble_set_wifi_connected(bool connected);
void ble_set_server_registered(bool registered);
bool ble_is_server_registered();
void ble_refresh_advertising();

#endif
