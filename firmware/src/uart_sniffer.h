#ifndef UART_SNIFFER_H
#define UART_SNIFFER_H

#include <Arduino.h>

void uart_sniffer_init();
void uart_sniffer_loop();
void uart_sniffer_set_baud(uint32_t baud);
uint32_t uart_sniffer_get_baud();

#endif
