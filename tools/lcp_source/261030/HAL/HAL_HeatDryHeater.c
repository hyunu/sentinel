/*
 * HAL_HeatDryHeater.c
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/HeatDryHeater.h"

/**
* @fn void HAL_HeatDryHeater_Init(void)
* HeatDryHeater에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		HeatDryHeater 초기화
*/
void HAL_HeatDryHeater_Init(void)
{
	HeatDryHeater_Init();
}

/**
* @fn void HAL_HeatDryHeater_TurnOn(void)
* HeatDryHeater에 대한 On 요청
* @param	없음
* @return	없음
* @see		HeatDryHeater 포트 On.
*/
void HAL_HeatDryHeater_TurnOn(void)
{
	HeatDryHeater_TurnOn();
}

/**
* @fn void HAL_HeatDryHeater_TurnOn_TestMode(void)
* HeatDryHeater에 대한 On 요청
* @param	없음
* @return	없음
* @see		HeatDryHeater 포트 On.
*/
void HAL_HeatDryHeater_TurnOn_TestMode(void)
{
	HeatDryHeater_TurnOn_TestMode();
}

/**
* @fn void HAL_HeatDryHeater_TurnOff(void)
* HeatDryHeater에 대한 Off 요청
* @param	없음
* @return	없음
* @see		HeatDryHeater 포트  off.
*/
void HAL_HeatDryHeater_TurnOff(void)
{
	HeatDryHeater_TurnOff();
}

/**
* @fn void HAL_HeatDryHeater_TurnOff_LQC(void)
* HeatDryHeater에 대한 Off 요청 (열풍 Fan 미동작)
* @param	없음
* @return	없음
* @see		HeatDryHeater 포트  off.
*/
void HAL_HeatDryHeater_TurnOff_LQC(void)
{
	HeatDryHeater_TurnOff_LQC();
}

/**
* @fn BOOL HAL_HeatDryHeater_IsOn(void)
* HeatDryHeater에 대한 상태 확인.
* @param	없음
* @return	BOOL				HeatDryHeater ON or OFF 상태 값
* @see		HeatDryHeater 상태 확인
*/
BOOL HAL_HeatDryHeater_IsOn(void)
{
	return HeatDryHeater_IsOn();
}

/**
* @fn void HAL_HeatDryHeater_RegularControl(void)
* HeatDryFan Regular 함수, Regular Control에서 Main 주기마다 호출
* @param	없음
* @return	없음
* @see
*/
void HAL_HeatDryHeater_RegularControl(void)
{
	HeatDryHeater_RegularControl();
}
