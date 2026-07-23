#ifndef DISPLAY_MANAGER_H
#define DISPLAY_MANAGER_H

#include <Arduino.h>

void display_init();
void display_update(const String &uid, bool wifiConnected, bool serverRegistered);

#endif
