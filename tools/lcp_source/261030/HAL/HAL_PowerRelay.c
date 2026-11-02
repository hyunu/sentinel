/*
 * HAL_PowerRelay.c
 *
 *  Created on: 2013. 7. 25.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/PowerRelay.h"

/**
* @fn void HAL_PowerRelay_TurnOn(void)
* PowerRelay에 대한 On 요청
* @param	없음
* @return	없음
* @see		PowerRelay 포트 On
*/
void HAL_PowerRelay_TurnOn(void)
{
	PowerRelay_TurnOn();
}

/**
* @fn void HAL_PowerRelay_TurnOff(void)
* PowerRelay에 대한 Off 요청
* @param	없음
* @return	없음
* @see		PowerRelay 포트  off
*/
void HAL_PowerRelay_TurnOff(void)
{
	PowerRelay_TurnOff();
}

/**
* @fn BOOL HAL_PowerRelay_IsOn(void)
* PowerRelay에 대한 상태 확인.
* @param	없음
* @return	BOOL				PowerRelay ON or OFF 상태 값
* @see		PowerRelay 상태 확인
*/
BOOL HAL_PowerRelay_IsOn(void)
{
	return PowerRelay_IsOn();
}
