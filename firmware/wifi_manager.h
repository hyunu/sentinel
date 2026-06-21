#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>

void wifi_init();
void wifi_connect(const String &ssid, const String &password);
void wifi_send_heartbeat();
void wifi_send_uart_data(const String &hex_data);
void wifi_send_temperature(float temp_celsius);
bool wifi_is_connected();
void wifi_loop();

#endif
