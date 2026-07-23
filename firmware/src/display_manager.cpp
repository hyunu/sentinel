#include <U8g2lib.h>

#include "display_manager.h"
#include "config.h"

static U8G2_SSD1306_72X40_ER_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA);
static bool displayReady = false;

static String lastUid = "";
static bool lastWifi = false;
static bool lastServer = false;

void display_init() {
    Serial.println("[DISPLAY] Init..."); Serial.flush();
    u8g2.begin();
    Serial.println("[DISPLAY] begin OK"); Serial.flush();
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.setCursor(0, 14);
    u8g2.print("Booting...");
    u8g2.sendBuffer();
    Serial.println("[DISPLAY] Boot screen OK"); Serial.flush();
    displayReady = true;
}

void display_update(const String &uid, bool wifiConnected, bool serverRegistered) {
    if (!displayReady) return;
    if (uid == lastUid && wifiConnected == lastWifi && serverRegistered == lastServer) return;
    lastUid = uid; lastWifi = wifiConnected; lastServer = serverRegistered;

    u8g2.clearBuffer();

    String displayUid = uid.length() > 0 ? uid : "---";

    u8g2.setFont(u8g2_font_logisoso24_tf);
    int iw = u8g2.getStrWidth(displayUid.c_str());
    u8g2.setCursor((OLED_WIDTH - iw) / 2, 24);
    u8g2.print(displayUid.c_str());

    u8g2.setFont(u8g2_font_6x10_tr);
    char status[16];
    snprintf(status, sizeof(status), "[%s] [%s]",
             wifiConnected     ? "AP" : "  ",
             serverRegistered  ? "SVR" : "   ");
    int sw = u8g2.getStrWidth(status);
    u8g2.setCursor((OLED_WIDTH - sw) / 2, 38);
    u8g2.print(status);

    u8g2.sendBuffer();
}
