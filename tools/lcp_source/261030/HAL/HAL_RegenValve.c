/*
 * HAL_RegenValve.c
 *
 *  Created on: 2013. 7. 26.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/RegenValve.h"

/**
* @fn void HAL_RegenValve_Init(void)
* Regen Valve 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		RegenValve 초기화
*/

void HAL_RegenValve_Init(void)
{
	RegenValve_Init();
}

/**
* @fn void HAL_RegenValve_TurnOn(void)
* Regen Valve 에 대한 On 요청
* @param	없음
* @return	없음
* @see		RegenValve 포트 On
*/

void HAL_RegenValve_TurnOn(void)
{
	RegenValve_TurnOn();
}

/**
* @fn void HAL_RegenValve_TurnOff(void)
* Regen Valve 에 대한 Off 요청
* @param	없음
* @return	없음
* @see		RegenValve 포트  off
*/
void HAL_RegenValve_TurnOff(void)
{
	RegenValve_TurnOff();
}

/**
* @fn BOOL HAL_RegenValve_IsOn(void)
* Regen Valve 에 대한 상태 확인.
* @param	없음
* @return	BOOL					Regen Valve ON or OFF 상태 값
* @see		RegenValve 상태 확인
*/
BOOL HAL_RegenValve_IsOn(void)
{
	return RegenValve_IsOn();
}

/**
* @fn void HAL_RegenValve_Isr_Timer_500us_DutyControl(void)
* 500us마다 호출되는 함수
* @param	없음
* @return	없음
* @see		500us 주기마다 실행하는 함수
*/
void HAL_RegenValve_Isr_Timer_500us_DutyControl(void)
{
	RegenValve_Isr_Timer_500us_DutyControl();
}
