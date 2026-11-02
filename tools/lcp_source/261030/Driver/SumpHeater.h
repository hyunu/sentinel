/*
 * SumpHeater.h
 *
 *  Created on: 2013. 7. 4.
 *      Author: youngho1.hwang
 */

#ifndef SUMPHEATER_H_
#define SUMPHEATER_H_

void SumpHeater_Init(void);
void SumpHeater_TurnOn(void);
void SumpHeater_TurnOff(void);
BOOL SumpHeater_IsOn(void);
double SumpHeater_GetEnergyUsageWatt(void);
void SumpHeater_SetIPMTempControl(void);
void SumpHeater_ClearIPMTempControl(void);

#endif /* SUMPHEATER_H_ */
