/*
 * SteamHeater.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#ifndef STEAMHEATER_H_
#define STEAMHEATER_H_

void SteamHeater_Init(void);
void SteamHeater_TurnOn(void);
void SteamHeater_TurnOff(void);
BOOL SteamHeater_IsOn(void);
double SteamHeater_GetEnergyUsageWatt(void);

#endif /* STEAMHEATER_H_ */
