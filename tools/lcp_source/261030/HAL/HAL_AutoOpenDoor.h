/*
 * HAL_AutoOpenDoor.h
 *
 *  Created on: 2015. 3. 10
 *      Author: yongtae.kwon
 */

#ifndef HAL_AUTOOPENDOOR_H_
#define HAL_AUTOOPENDOOR_H_

#include "../Driver/AutoOpenDoor.h"

void HAL_AutoOpenDoor_Init(void);
void HAL_AutoOpenDoor_Open(void);
void HAL_AutoOpenDoor_Close(void);
void HAL_AutoOpenDoor_TurnOff(void);
T_E_AODMotorStatus HAL_AutoOpenDoor_IsMotorStatus(void);

#endif /* HAL_AUTOOPENDOOR_H_ */
