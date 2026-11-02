/*
 * HAL_SteamValve.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#ifndef HAL_STEAMVALVE_H_
#define HAL_STEAMVALVE_H_

void HAL_SteamValve_Init(void);
void HAL_SteamValve_TurnOn(void);
void HAL_SteamValve_TurnOff(void);
BOOL HAL_SteamValve_IsOn(void);
void HAL_SteamValve_Isr_Timer_500us_DutyControl(void);

#endif /* HAL_STEAMVALVE_H_ */
