/*
 * RinseRefill.h
 *
 *  Created on: 2013. 7. 10.
 *      Author: youngho1.hwang
 */

#ifndef RINSEREFILL_H_
#define RINSEREFILL_H_

void RinseRefill_Init(void);
BOOL RinseRefill_IsEmpty(void);
void RinseRefill_Isr_Timer_50ms_SensingSignal(void);

#endif /* RINSEREFILL_H_ */
