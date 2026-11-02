/*
 * HeatDryHeater.h
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#ifndef HEATDRYHEATER_H_
#define HEATDRYHEATER_H_

void HeatDryHeater_Init(void);
void HeatDryHeater_TurnOn(void);
void HeatDryHeater_TurnOn_TestMode(void);
void HeatDryHeater_TurnOff(void);
void HeatDryHeater_TurnOff_LQC(void);
BOOL HeatDryHeater_IsOn(void);
void HeatDryHeater_RegularControl(void);
double HeatDryHeater_GetEnergyUsageWatt(void);
BOOL HeatDryHeater_IsElapsedOff(void);

#endif /* HEATDRYHEATER_H_ */
