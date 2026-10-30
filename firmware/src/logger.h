#ifndef SENTINEL_LOGGER_H
#define SENTINEL_LOGGER_H

#include <Arduino.h>

// Serial logger that also forwards complete lines to the BLE log
// characteristic. Board-side diagnostics are therefore visible from the
// mobile app even when the board cannot reach the server.
class AppLogger {
public:
    void begin(unsigned long baud);
    void printf(const char *format, ...);
    void println(const String &text = "");
    void print(const String &text);
    void flush();
};

extern AppLogger AppLog;

#endif
