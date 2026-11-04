#include <Arduino.h>

#include "status_led.h"
#include "config.h"

// Most ESP32-C3 mini boards wire the single-color LED between 3V3 and GPIO8,
// so driving the pin LOW turns it on.
void status_led_init() {
    pinMode(STATUS_LED_PIN, OUTPUT);
    status_led_set(false);
}

void status_led_set(bool on) {
#if STATUS_LED_ACTIVE_LOW
    digitalWrite(STATUS_LED_PIN, on ? LOW : HIGH);
#else
    digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
#endif
}
