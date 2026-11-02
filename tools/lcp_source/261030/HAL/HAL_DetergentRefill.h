/*
 * HAL_DetergentRefill.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#ifndef HAL_DETERGENTREFILL_H_
#define HAL_DETERGENTREFILL_H_

void HAL_DetergentRefill_Init(void);
BOOL HAL_DetergentRefill_IsEmpty(void);
void HAL_DetergentRefill_Isr_Timer_50ms_SensingSignal(void);

#endif /* HAL_DETERGENTREFILL_H_ */
