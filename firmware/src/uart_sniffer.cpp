#include "uart_sniffer.h"
#include "config.h"
#include "logger.h"

#include <Preferences.h>

struct FrameParser {
    uint8_t buf[1024];
    int pos;
    int expected_len;
};

static FrameParser parser_rx = {};
static FrameParser parser_tx = {};
static uint32_t current_baud = UART_BAUD_RATE;
static volatile uint32_t pending_baud = 0;
static volatile uint32_t rx_bytes = 0;
static volatile uint32_t tx_bytes = 0;
static volatile uint32_t rx_frames = 0;
static volatile uint32_t tx_frames = 0;
static volatile uint32_t rx_edges = 0;
static volatile uint32_t tx_edges = 0;

static void IRAM_ATTR rx_edge_isr() { rx_edges++; }
static void IRAM_ATTR tx_edge_isr() { tx_edges++; }

static const char *NVS_NS = "sentinel";
static const char *NVS_BAUD_KEY = "baud";

extern void on_frame_received(const uint8_t *data, int len, const char *direction);

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

static void reset_parser(FrameParser &parser) {
    parser.pos = 0;
    parser.expected_len = 0;
}

static void begin_uart(uint32_t baud) {
    // Initialize UART0 first, then UART1. UART0's default pins are 20/21, so
    // starting it after UART1 can steal GPIO20 from the UART1 RX assignment.
    //
    // UART0 captures the opposite direction on GPIO21. UART0 is free because
    // ARDUINO_USB_CDC_ON_BOOT=1 maps the Arduino Serial logger to USB CDC.
    Serial0.end();
    Serial0.setRxBufferSize(2048);
    Serial0.begin(baud, SERIAL_8N1, UART_CAPTURE_TX_PIN,
                  UART_CAPTURE_TX_DUMMY_TX);

    // UART1 captures the RX direction on GPIO20.
    // 2 KB at 19200 bps is about one second of traffic; the capture task
    // drains it every millisecond, and the C3 needs heap for HTTP/BLE.
    Serial1.end();
    Serial1.setRxBufferSize(2048);
    Serial1.begin(baud, SERIAL_8N1, UART_CAPTURE_RX_PIN,
                  UART_CAPTURE_RX_DUMMY_TX);

    reset_parser(parser_rx);
    reset_parser(parser_tx);
}

void uart_sniffer_init() {
    current_baud = load_stored_baud();

    // Diagnostic: an idle UART TX line is high. With a pull-down enabled,
    // a connected adapter should read 1; a floating/disconnected pin reads 0.
    pinMode(UART_CAPTURE_RX_PIN, INPUT_PULLDOWN);
    pinMode(UART_CAPTURE_TX_PIN, INPUT_PULLDOWN);
    delay(5);
    AppLog.printf("[UART] idle levels RX=%d TX=%d\n",
                  digitalRead(UART_CAPTURE_RX_PIN),
                  digitalRead(UART_CAPTURE_TX_PIN));

    begin_uart(current_baud);
    // Edge counters diagnose whether a signal reaches the pins at all,
    // independently of the UART peripheral's frame parser.
    attachInterrupt(digitalPinToInterrupt(UART_CAPTURE_RX_PIN), rx_edge_isr,
                    CHANGE);
    attachInterrupt(digitalPinToInterrupt(UART_CAPTURE_TX_PIN), tx_edge_isr,
                    CHANGE);

    AppLog.printf("[UART] Sniffer baud=%lu dual RX=%d,%d\n",
                  (unsigned long)current_baud, UART_CAPTURE_RX_PIN,
                  UART_CAPTURE_TX_PIN);
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
    begin_uart(current_baud);

    Preferences prefs;
    if (prefs.begin(NVS_NS, false)) {
        prefs.putUInt(NVS_BAUD_KEY, current_baud);
        prefs.end();
    }

    AppLog.printf("[UART] Baud changed to %lu\n", (unsigned long)current_baud);
}

static void emit_frame(FrameParser &parser, const char *direction) {
    if (direction[0] == 'T') {
        tx_frames++;
    } else {
        rx_frames++;
    }
    on_frame_received(parser.buf, parser.pos, direction);
    reset_parser(parser);
}

static void process_byte(FrameParser &parser, uint8_t b,
                         const char *direction) {
    if (parser.pos == 0) {
        if (b == FRAME_START_BYTE) {
            parser.buf[0] = b;
            parser.pos = 1;
            parser.expected_len = 0;
        }
        return;
    }

    parser.buf[parser.pos++] = b;

    // LCP monitoring uses AA [LEN:1] FID … BB where LEN is the total frame
    // size including STX (e.g. 0x8A == 138). Do not treat every 0xBB as an
    // end marker — payload bytes can legally contain 0xBB.
    if (parser.pos == 2) {
        parser.expected_len = parser.buf[1];
        if (parser.expected_len < 5 ||
            parser.expected_len > (int)sizeof(parser.buf)) {
            reset_parser(parser);
            return;
        }
    }

    if (parser.expected_len > 0 && parser.pos >= parser.expected_len) {
        if (parser.buf[parser.pos - 1] == FRAME_END_BYTE) {
            emit_frame(parser, direction);
        } else {
            reset_parser(parser);
        }
        return;
    }

    if (parser.pos >= (int)sizeof(parser.buf)) {
        reset_parser(parser);
    }
}

void uart_sniffer_loop() {
    apply_pending_baud();

    // Read both directions independently. Each parser keeps its own frame
    // state so interleaved traffic cannot corrupt the other channel.
    while (Serial1.available()) {
        rx_bytes++;
        process_byte(parser_rx, (uint8_t)Serial1.read(), "RX");
    }
    while (Serial0.available()) {
        tx_bytes++;
        process_byte(parser_tx, (uint8_t)Serial0.read(), "TX");
    }
}

void uart_sniffer_log_stats() {
    AppLog.printf(
        "[UART] RX bytes=%lu frames=%lu edges=%lu | "
        "TX bytes=%lu frames=%lu edges=%lu\n",
        (unsigned long)rx_bytes, (unsigned long)rx_frames,
        (unsigned long)rx_edges, (unsigned long)tx_bytes,
        (unsigned long)tx_frames, (unsigned long)tx_edges);
}
