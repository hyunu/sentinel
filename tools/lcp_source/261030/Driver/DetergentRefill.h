/*
 * DetergentRefill.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#ifndef DETERGENTREFILL_H_
#define DETERGENTREFILL_H_

void DetergentRefill_Init(void);
BOOL DetergentRefill_IsEmpty(void);
void DetergentRefill_Isr_Timer_50ms_SensingSignal(void);

#endif /* DETERGENTREFILL_H_ */
