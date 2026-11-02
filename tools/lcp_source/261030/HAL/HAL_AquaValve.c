/*
 * HAL_AquaValve.c
 *
 *  Created on: 2013. 7. 30.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/AquaValve.h"

/**
* @fn void HAL_AquaValve_Init(void)
* Aquastop Valve 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		WaterValve 초기화
*/

void HAL_AquaValve_Init(void)
{
	AquaValve_Init();
}

/**
* @fn void HAL_AquaValve_TurnOn(void)
* Aquastop Valve 에 대한 On 요청
* @param	없음
* @return	없음
* @see		WaterValve 포트 On
*/

void HAL_AquaValve_TurnOn(void)
{
	AquaValve_TurnOn();
}

/**
* @fn void HAL_AquaValve_TurnOff(void)
* Aquastop Valve 에 대한 Off 요청
* @param	없음
* @return	없음
* @see		WaterValve 포트  off
*/
void HAL_AquaValve_TurnOff(void)
{
	AquaValve_TurnOff();
}

/**
* @fn BOOL HAL_AquaValve_IsOn(void)
* Aquastop Valve 에 대한 상태 확인.
* @param	없음
* @return	BOOL					Aquastop Valve ON or OFF 상태 값
* @see		WaterValve 상태 확인
*/
BOOL HAL_AquaValve_IsOn(void)
{
	return AquaValve_IsOn();
}
