/*
 * HAL_RinseRefill.h
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#ifndef HAL_RINSEREFILL_H_
#define HAL_RINSEREFILL_H_

void HAL_RinseRefill_Init(void);
BOOL HAL_RinseRefill_IsEmpty(void);
void HAL_RinseRefill_Isr_Timer_50ms_SensingSignal(void);

#endif /* HAL_RINSEREFILL_H_ */
