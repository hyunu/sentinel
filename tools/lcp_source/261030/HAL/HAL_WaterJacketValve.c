/*
 * HAL_WaterJacketValve.c
 *
 *  Created on: 2015. 3. 10.
 *      Author: yongtae.kwon
 */

#include "../Common/Type.h"
#include "../Driver/WaterJacketValve.h"

/**
* @fn void HAL_WaterJacketValve_Init(void)
* WaterJacketValve에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		WaterJacketValve 초기화
*/

void HAL_WaterJacketValve_Init(void)
{
	WaterJacketValve_Init();
}

/**
* @fn void HAL_WaterJacketValve_TurnOn(void)
* WaterJacketValve에 대한 On 요청
* @param	없음
* @return	없음
* @see		WaterJacketValve 포트 On, 이전 WaterJacketValve 포트 상태값 저장.
*/

void HAL_WaterJacketValve_TurnOn(void)
{
	WaterJacketValve_TurnOn();
}

/**
* @fn void HAL_WaterJacketValve_TurnOff(void)
* WaterJacketValve에 대한 Off 요청
* @param	없음
* @return	없음
* @see		WaterJacketValve 포트  off, 이전 WaterJacketValve 포트 상태값 저장.
*/
void HAL_WaterJacketValve_TurnOff(void)
{
	WaterJacketValve_TurnOff();
}

/**
* @fn BOOL HAL_WaterJacketValve_IsOn(void)
* WaterJacketValve에 대한 상태 확인.
* @param	없음
* @return	BOOL				WaterJacketValve ON or OFF 상태 값
* @see		WaterJacketValve 상태 확인
*/
BOOL HAL_WaterJacketValve_IsOn(void)
{
	return WaterJacketValve_IsOn();
}

/**
* @fn void HAL_WaterJacketValve_Isr_Timer_500us_DutyControl(void)
* 500us마다 호출되는 함수
* @param	없음
* @return	없음
* @see		500us 주기마다 실행하는 함수
*/
void HAL_WaterJacketValve_Isr_Timer_500us_DutyControl(void)
{
	WaterJacketValve_Isr_Timer_500us_DutyControl();
}
