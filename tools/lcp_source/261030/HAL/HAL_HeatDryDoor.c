/*
 * HAL_HeatDryDoor.c
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/HeatDryDoor.h"

/**
* @fn void HAL_HeatDryDoor_Init(void)
* Heat Dry Door에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		Heat Dry Door 초기화
*/
void HAL_HeatDryDoor_Init(void)
{
	HeatDryDoor_Init();
}

/**
* @fn BOOL HAL_HeatDryDoor_IsOpen(void)
* * @param	없음
* @return	BOOL				Heat Dry Door Open or Close 상태 값
* @see		Heat Dry Door Open 상태 확인
*/

BOOL HAL_HeatDryDoor_IsOpen(void)
{
	return HeatDryDoor_IsOpen();
}

/**
* @fn BOOL HAL_HeatDryDoor_ISR_TIMER_10ms_SensingSignal(void)
* Heat Dry Door Status 갱신, Time critical 하므로 10ms 인터럽에서 호출
* @param	없음
* @return	없음
* @see		2ms마다 Port 입력 값 확인하여 Heat Dry Door Open 상태 변경.
*/
void HAL_HeatDryDoor_Isr_Timer_10ms_SensingSignal(void)
{
	HeatDryDoor_Isr_10ms_SensingSignal();
}
