/*
 * HAL_RegenValve.h
 *
 *  Created on: 2013. 7. 26.
 *      Author: seongju.lim
 */

#ifndef HAL_REGENVALVE_H_
#define HAL_REGENVALVE_H_

void HAL_RegenValve_Init(void);
void HAL_RegenValve_TurnOn(void);
void HAL_RegenValve_TurnOff(void);
BOOL HAL_RegenValve_IsOn(void);
void HAL_RegenValve_Isr_Timer_500us_DutyControl(void);

#endif /* HAL_REGENVALVE_H_ */
