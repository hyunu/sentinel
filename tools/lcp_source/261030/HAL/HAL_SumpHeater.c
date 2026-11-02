/*
 * HAL_SumpHeater.c
 *
 *  Created on: 2013. 7. 24.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/SumpHeater.h"

/**
* @fn void HAL_SumpHeater_Init(void)
* SumpHeater에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SumpHeater 초기화
*/

void HAL_SumpHeater_Init(void)
{
	SumpHeater_Init();
}

/**
* @fn void HAL_SumpHeater_TurnOn(void)
* SumpHeater에 대한 On 요청
* @param	없음
* @return	없음
* @see		SumpHeater 포트 On.
*/

void HAL_SumpHeater_TurnOn(void)
{
	SumpHeater_TurnOn();
}

/**
* @fn void HAL_SumpHeater_TurnOff(void)
* SumpHeater에 대한 Off 요청
* @param	없음
* @return	없음
* @see		SumpHeater 포트  off.
*/
void HAL_SumpHeater_TurnOff(void)
{
	SumpHeater_TurnOff();
}

/**
* @fn BOOL HAL_SumpHeater_IsOn(void)
* SumpHeater에 대한 상태 확인.
* @param	없음
* @return	BOOL				SumpHeater ON or OFF 상태 값
* @see		SumpHeater 상태 확인
*/
BOOL HAL_SumpHeater_IsOn(void)
{
	return SumpHeater_IsOn();
}
