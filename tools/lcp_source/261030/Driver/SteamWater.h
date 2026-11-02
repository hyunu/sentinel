/*
 * SteamWater.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#ifndef STEAMWATER_H_
#define STEAMWATER_H_

void SteamWater_Init(void);
BOOL SteamWater_IsSteamWater(void);
void SteamWater_Isr_Timer_10ms_SensingSignal(void);

#endif /* STEAMWATERLEVEL_H_ */
