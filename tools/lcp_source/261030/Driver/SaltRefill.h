/*
 * SaltRefill.h
 *
 *  Created on: 2013. 7. 10.
 *      Author: youngho1.hwang
 */

#ifndef SALTREFILL_H_
#define SALTREFILL_H_

void SaltRefill_Init(void);
BOOL SaltRefill_IsEmpty(void);
void SaltRefill_Isr_Timer_50ms_SensingSignal(void);

#endif /* SALTREFILL_H_ */
