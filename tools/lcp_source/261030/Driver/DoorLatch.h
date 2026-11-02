/*
 * Door.h
 *
 *  Created on: 2013. 7. 8.
 *      Author: youngho1.hwang
 */

#ifndef DOOR_H_
#define DOOR_H_

void DoorLatch_Init(void);
BOOL DoorLatch_IsOpen(void);
BOOL DoorLatch_IsOpen_DoorLatch_1(void);
BOOL DoorLatch_IsOpen_DoorLatch_2(void);
void DoorLatch_Isr_2ms_SensingSignal(void);

#endif /* DOOR_H_ */

