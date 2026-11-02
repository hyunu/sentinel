/*
 * WaterJacketValve.h
 *
 *  Created on: 2015. 3. 10.
 *      Author: yongtae.kwon
 */

#ifndef WATERJACKETVALVE_H_
#define WATERJACKETVALVE_H_

void WaterJacketValve_Init(void);
void WaterJacketValve_TurnOn(void);
void WaterJacketValve_TurnOff(void);
BOOL WaterJacketValve_IsOn(void);
void WaterJacketValve_Isr_Timer_500us_DutyControl(void);

#endif /* WATERJACKETVALVE_H_ */
