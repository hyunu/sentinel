/*
 * HAL_AUTOOPENDOOR.c
 *
 *  Created on: 2015. 3. 10.
 *      Author: yongtae.kwon
 */

#include "../Common/Type.h"
#include "../Driver/AutoOpenDoor.h"

/**
* @fn void HAL_AutoOpenDoor_Init(void)
* AutoOpenDoor 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		AutoOpenDoor 초기화
*/

void HAL_AutoOpenDoor_Init(void)
{
	AutoOpenDoor_Init();
}

/**
* @fn void HAL_AutoOpenDoor_Open(void)
* AutoOpenDoor 에 대한 Open 요청
* @param	없음
* @return	없음
* @see		AutoOpenDoor Open On, Close Off
*/

void HAL_AutoOpenDoor_Open(void)
{
	AutoOpenDoor_Open();
}

/**
* @fn void HAL_AutoOpenDoor_Close(void)
* AutoOpenDoor에 대한 Close 요청
* @param	없음
* @return	없음
* @see		AutoOpenDoor Open Off, Close On
*/
void HAL_AutoOpenDoor_Close(void)
{
	AutoOpenDoor_Close();
}

/**
* @fn void HAL_AutoOpenDoor_TurnOff(void)
* AutoOpenDoor에 대한 Motor 정지 요청
* @param	없음
* @return	없음
* @see		AutoOpenDoor Open Off, Close Off
*/
void HAL_AutoOpenDoor_TurnOff(void)
{
	AutoOpenDoor_TurnOff();
}

/**
* @fn T_E_AODMotorStatus HAL_AutoOpenDoor_IsMotorStatus(void)
* AutoOpenDoor에 대한 Motor 상태 확인
* @param	없음
* @return	meAODMotorStatus
* @see
*/
T_E_AODMotorStatus HAL_AutoOpenDoor_IsMotorStatus(void)
{
	return AutoOpenDoor_IsMotorStatus();
}
