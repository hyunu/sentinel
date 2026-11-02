/*
 * RegenValve.h
 *
 *  Created on: 2013. 7. 4
 *      Author: seongju.lim
 */

#ifndef REGENVALVE_H_
#define REGENVALVE_H_

void RegenValve_Init(void);
void RegenValve_TurnOn(void);
void RegenValve_TurnOff(void);
BOOL RegenValve_IsOn(void);
void RegenValve_Isr_Timer_500us_DutyControl(void);

#endif /* REGENVALVE_H_ */
