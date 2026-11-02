/*
 * HAL_SteamWater.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#ifndef HAL_STEAMWATER_H_
#define HAL_STEAMWATER_H_

void HAL_SteamWater_Init(void);
BOOL HAL_SteamWater_IsSteamWater(void);
void HAL_SteamWater_Isr_Timer_10ms_SensingSignal(void);

#endif /* HAL_STEAMWATER_H_ */
