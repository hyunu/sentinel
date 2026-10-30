#include "logger.h"

#include <cstdarg>

#include "ble_service.h"

AppLogger AppLog;

void AppLogger::begin(unsigned long baud) {
    Serial.begin(baud);
}

void AppLogger::printf(const char *format, ...) {
    char buffer[512];
    va_list args;
    va_start(args, format);
    vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);

    Serial.print(buffer);
    ble_send_log(String(buffer));
}

void AppLogger::println(const String &text) {
    Serial.println(text);
    ble_send_log(text);
}

void AppLogger::print(const String &text) {
    Serial.print(text);
}

void AppLogger::flush() {
    Serial.flush();
}
