/*
 * HAL_TubLamp.c
 *
 *  Created on: 2015. 3. 10.
 *      Author: yongtae.kwon
 */

#include "../Common/Type.h"
#include "../Driver/TubLamp.h"

/**
* @fn void HAL_TubLamp_Init(void)
* TubLamp 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		TubLamp 초기화
*/

void HAL_TubLamp_Init(void)
{
	TubLamp_Init();
}

/**
* @fn void HAL_TubLamp_TurnOn(void)
* TubLamp 에 대한 On 요청
* @param	없음
* @return	없음
* @see		TubLamp 포트 On
*/

void HAL_TubLamp_TurnOn(void)
{
	TubLamp_TurnOn();
}

/**
* @fn void HAL_TubLamp_TurnOff(void)
* Tub Lamp 에 대한 Off 요청
* @param	없음
* @return	없음
* @see		TubLamp 포트  off
*/
void HAL_TubLamp_TurnOff(void)
{
	TubLamp_TurnOff();
}

/**
* @fn BOOL HAL_TubLamp_IsOn(void)
* TubLamp 에 대한 상태 확인.
* @param	없음
* @return	BOOL	TubLamp ON or OFF 상태 값
* @see		TubLamp 상태 확인
*/
BOOL HAL_TubLamp_IsOn(void)
{
	return TubLamp_IsOn();
}

/**
* @fn void HAL_TubLamp_SetBrightness(T_E_TubLampBrightLevel eBrightLevel)
* TubLamp 밝기 Duty 설정
* @param	T_E_TubLampBrightLevel		밝기설정값
* @return		없음
* @see		TubLamp 밝기 설정
*/
void HAL_TubLamp_SetBrightness(T_E_TubLampBrightLevel eBrightLevel)
{
	TubLamp_SetBrightness(eBrightLevel);
}

/**
* @fn void HAL_TubLamp_Isr_Timer_1ms_DutyControl(void)
* 500us마다 호출되는 함수
* @param	없음
* @return	없음
* @see		1ms 주기마다 실행하는 함수
*/
void HAL_TubLamp_Isr_Timer_1ms_DutyControl(void)
{
	TubLamp_Isr_Timer_1ms_DutyControl();
}
