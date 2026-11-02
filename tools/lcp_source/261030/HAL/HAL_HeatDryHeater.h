/*
 * HAL_HeatDryHeater.h
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#ifndef HAL_HEATDRYHEATER_H_
#define HAL_HEATDRYHEATER_H_

void HAL_HeatDryHeater_Init(void);
void HAL_HeatDryHeater_TurnOn(void);
void HAL_HeatDryHeater_TurnOn_TestMode(void);
void HAL_HeatDryHeater_TurnOff(void);
void HAL_HeatDryHeater_TurnOff_LQC(void);
BOOL HAL_HeatDryHeater_IsOn(void);
void HAL_HeatDryHeater_RegularControl(void);

#endif /* HAL_HEATDRYHEATER_H_ */
