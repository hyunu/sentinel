#ifndef BLE_SERVICE_H
#define BLE_SERVICE_H

#include <Arduino.h>

void ble_init();
void ble_send_uart_data(const String &hex_str);

#endif
