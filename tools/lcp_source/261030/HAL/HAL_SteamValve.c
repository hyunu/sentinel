/*
 * HAL_SteamValve.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/SteamValve.h"


/**
* @fn void HAL_SteamValve_Init(void)
* SteamValver에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SteamValver 초기화
*/
void HAL_SteamValve_Init(void)
{
	SteamValve_Init();
}

/**
* @fn void HAL_SteamValve_TurnOn(void)
* SteamValver에 대한 On 요청
* @param	없음
* @return	없음
* @see		SteamValver 포트 On.
*/
void HAL_SteamValve_TurnOn(void)
{
	SteamValve_TurnOn();
}

/**
* @fn void HAL_SteamValve_TurnOff(void)
* SteamValver에 대한 Off 요청
* @param	없음
* @return	없음
* @see		SteamValver 포트  off.
*/
void HAL_SteamValve_TurnOff(void)
{
	SteamValve_TurnOff();
}

/**
* @fn BOOL HAL_SteamValve_IsOn(void)
* SteamValver에 대한 상태 확인.
* @param	없음
* @return	BOOL				SteamValver ON or OFF 상태 값
* @see		SteamValver 상태 확인
*/
BOOL HAL_SteamValve_IsOn(void)
{
	return SteamValve_IsOn();
}

/**
* @fn void HAL_SteamValve_Isr_Timer_500us_DutyControl(void)
* 500us마다 호출되는 함수
* @param	없음
* @return	없음
* @see		500us 주기마다 실행하는 함수
*/
void HAL_SteamValve_Isr_Timer_500us_DutyControl(void)
{
	SteamValve_Isr_Timer_500us_DutyControl();
}
