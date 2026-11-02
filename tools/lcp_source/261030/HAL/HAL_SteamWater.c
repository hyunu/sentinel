/*
 * HAL_SteamWater.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/SteamWater.h"


/**
* @fn void SteamWater_Init(void)
* SteamWater 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SteamWater 초기화
*/
void HAL_SteamWater_Init(void)
{
	SteamWater_Init();
}

/**
* @fn BOOL SteamWater_IsWater(void)
* @param	없음
* @return	BOOL				Steam Water 상태 값
* @see		Steam Water 상태 확인
*/
BOOL HAL_SteamWater_IsSteamWater(void)
{
	return SteamWater_IsSteamWater();
}

/**
* @fn BOOL SteamWater_Isr_Timer_10ms_SensingSignal(void)
* Steam Water Level 포트 값 확인하여, 통 상태 확인
* @param	없음
* @return	없음
* @see
*/
void HAL_SteamWater_Isr_Timer_10ms_SensingSignal(void)
{
	SteamWater_Isr_Timer_10ms_SensingSignal();
}
