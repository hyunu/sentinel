#pragma once

void wifi_init(void);
void wifi_connect(const char *ssid, const char *password);
void wifi_send_heartbeat(void);
void wifi_send_uart_data(const char *hex_data, int len);
void wifi_send_temperature(float temp_celsius);
