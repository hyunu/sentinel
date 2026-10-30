#include "uart_sniffer.h"
#include "config.h"
#include "logger.h"

#include <Preferences.h>

static uint8_t frame_buf[1024];
static int frame_pos = 0;
static int frame_expected_len = 0;
static uint32_t current_baud = UART_BAUD_RATE;
static volatile uint32_t pending_baud = 0;

static const char *NVS_NS = "sentinel";
static const char *NVS_BAUD_KEY = "baud";

extern void on_frame_received(const uint8_t *data, int len);

static bool is_valid_baud(uint32_t baud) {
    return baud >= UART_BAUD_MIN && baud <= UART_BAUD_MAX;
}

static uint32_t load_stored_baud() {
    Preferences prefs;
    if (!prefs.begin(NVS_NS, true)) {
        return UART_BAUD_RATE;
    }
    uint32_t baud = prefs.getUInt(NVS_BAUD_KEY, UART_BAUD_RATE);
    prefs.end();
    return is_valid_baud(baud) ? baud : UART_BAUD_RATE;
}

static void begin_uart(uint32_t baud) {
    Serial1.end();
    Serial1.setRxBufferSize(65536);
    Serial1.begin(baud, SERIAL_8N1, UART_MONITOR_RX, UART_MONITOR_TX);
}

void uart_sniffer_init() {
    current_baud = load_stored_baud();
    begin_uart(current_baud);
    AppLog.printf("[UART] Sniffer baud=%lu\n", (unsigned long)current_baud);
}

void uart_sniffer_set_baud(uint32_t baud) {
    if (!is_valid_baud(baud)) {
        AppLog.printf("[UART] Ignoring invalid baud=%lu (valid %d..%d)\n",
                      (unsigned long)baud, UART_BAUD_MIN, UART_BAUD_MAX);
        return;
    }
    // BLE callbacks run on another task; apply the change from the main loop.
    pending_baud = baud;
}

uint32_t uart_sniffer_get_baud() {
    return current_baud;
}

static void apply_pending_baud() {
    uint32_t baud = pending_baud;
    if (baud == 0 || baud == current_baud) {
        pending_baud = 0;
        return;
    }
    pending_baud = 0;
    current_baud = baud;
    frame_pos = 0;
    frame_expected_len = 0;
    begin_uart(current_baud);

    Preferences prefs;
    if (prefs.begin(NVS_NS, false)) {
        prefs.putUInt(NVS_BAUD_KEY, current_baud);
        prefs.end();
    }

    AppLog.printf("[UART] Baud changed to %lu\n", (unsigned long)current_baud);
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
    apply_pending_baud();
    while (Serial1.available()) {
        uint8_t b = Serial1.read();
        process_byte(b);
    }
}
