#pragma once

void ble_init(void);
void ble_send_uart_data(const char *hex_data, int len);
