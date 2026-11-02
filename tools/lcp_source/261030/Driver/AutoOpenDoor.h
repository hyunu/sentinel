/*
 * AutoOpenDoor.h
 *
 *  Created on: 2015. 3. 10
 *      Author: yongtae.kwon
 */

#ifndef AUTOOPENDOOR_H_
#define AUTOOPENDOOR_H_

/**
 * ADO Motor 동작 관련
 */
typedef enum
{
	AOD_MOTOR_STOP = 0,
	AOD_MOTOR_OPEN,
	AOD_MOTOR_CLOSE,

	AOD_MOTOR_MAX
} T_E_AODMotorStatus;

void AutoOpenDoor_Init(void);
void AutoOpenDoor_Open(void);
void AutoOpenDoor_Close(void);
void AutoOpenDoor_TurnOff(void);
T_E_AODMotorStatus AutoOpenDoor_IsMotorStatus(void);

#endif /* AUTOOPENDOOR_H_ */
