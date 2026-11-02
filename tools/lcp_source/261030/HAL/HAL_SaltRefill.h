/*
 * HAL_SaltRefill.h
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#ifndef HAL_SALTREFILL_H_
#define HAL_SALTREFILL_H_

void HAL_SaltRefill_Init(void);
BOOL HAL_SaltRefill_IsEmpty(void);
void HAL_SaltRefill_Isr_Timer_50ms_SensingSignal(void);

#endif /* HAL_SALTREFILL_H_ */
