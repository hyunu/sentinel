/*
 * HAL_SteamHeater.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#ifndef HAL_STEAMHEATER_H_
#define HAL_STEAMHEATER_H_

void HAL_SteamHeater_Init(void);
void HAL_SteamHeater_TurnOn(void);
void HAL_SteamHeater_TurnOff(void);
BOOL HAL_SteamHeater_IsOn(void);

#endif /* HAL_STEAMHEATER_H_ */
