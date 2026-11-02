/*
 * HAL_DoorLatch.h
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#ifndef HAL_DOORLATCH_H_
#define HAL_DOORLATCH_H_

void HAL_DoorLatch_Init(void);
BOOL HAL_DoorLatch_IsOpen(void);
BOOL HAL_DoorLatch_IsOpen_DoorLatch_1(void);
BOOL HAL_DoorLatch_IsOpen_DoorLatch_2(void);
void HAL_DoorLatch_Isr_Timer_2ms_SensingSignal(void);

#endif /* HAL_DOORLATCH_H_ */
