/*
 * SteamValve.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#ifndef STEAMVALVE_H_
#define STEAMVALVE_H_

void SteamValve_Init(void);
void SteamValve_TurnOn(void);
void SteamValve_TurnOff(void);
BOOL SteamValve_IsOn(void);
void SteamValve_Isr_Timer_500us_DutyControl(void);

#endif /* STEAMVALVE_H_ */
