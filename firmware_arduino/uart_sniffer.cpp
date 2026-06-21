#include "uart_sniffer.h"
#include "config.h"

static uint8_t frame_buf[1024];
static int frame_pos = 0;
static int frame_expected_len = 0;

extern void on_frame_received(const uint8_t *data, int len);

void uart_sniffer_init() {
    Serial1.begin(UART_BAUD_RATE, SERIAL_8N1, UART_MONITOR_RX, UART_MONITOR_TX);
}

static void process_byte(uint8_t b) {
    if (frame_pos == 0) {
        if (b == FRAME_START_BYTE) {
            frame_buf[0] = b;
            frame_pos = 1;
            frame_expected_len = 0;
        }
        return;
    }

    frame_buf[frame_pos++] = b;

    if (frame_pos == 3 && frame_expected_len == 0) {
        frame_expected_len = (frame_buf[1] << 8) | frame_buf[2];
    }

    if (b == FRAME_END_BYTE && frame_pos > 4) {
        on_frame_received(frame_buf, frame_pos);
        frame_pos = 0;
        frame_expected_len = 0;
        return;
    }

    if (frame_expected_len > 0 && frame_pos >= frame_expected_len + 1) {
        if (b == FRAME_END_BYTE) {
            on_frame_received(frame_buf, frame_pos);
        }
        frame_pos = 0;
        frame_expected_len = 0;
        return;
    }

    if (frame_pos >= (int)sizeof(frame_buf)) {
        frame_pos = 0;
        frame_expected_len = 0;
    }
}

void uart_sniffer_loop() {
    while (Serial1.available()) {
        uint8_t b = Serial1.read();
        process_byte(b);
    }
}
