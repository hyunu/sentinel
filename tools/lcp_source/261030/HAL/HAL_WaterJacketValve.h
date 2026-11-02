/*
 * HAL_WaterJacketValve.h
 *
 *  Created on: 2015. 3. 10.
 *      Author: yongtae.kwon
 */

#ifndef HAL_WATERJACKETVALVE_H_
#define HAL_WATERJACKETVALVE_H_

void HAL_WaterJacketValve_Init(void);
void HAL_WaterJacketValve_TurnOn(void);
void HAL_WaterJacketValve_TurnOff(void);
BOOL HAL_WaterJacketValve_IsOn(void);
void HAL_WaterJacketValve_Isr_Timer_500us_DutyControl(void);

#endif /* HAL_WATERJACKETVALVE_H_ */
