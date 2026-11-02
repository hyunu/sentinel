/*
 * SteamWater.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

#define		STEAMWATER_CHATTERING_TIME		(7)		/* 7 * 10ms = 70ms */

static BOOL mb_IsSteamWater;
static UINT16 munSteamWaterChatteringCount;

/**
* @fn void SteamWater_Init(void)
* SteamWater 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SteamWater 초기화
*/
void SteamWater_Init(void)
{
	munSteamWaterChatteringCount = CLEAR;
	mb_IsSteamWater = FALSE;
}

/**
* @fn BOOL SteamWater_IsSteamWater(void)
* @param	없음
* @return	BOOL				Steam Water 상태 값
* @see		Steam Water 유무 확인
*/
BOOL SteamWater_IsSteamWater(void)
{
	return mb_IsSteamWater;
}

/**
* @fn BOOL SteamWater_Isr_Timer_10ms_SensingSignal(void)
* Steam Water  포트 값 확인하여, 통 상태 확인
* @param	없음
* @return	없음
* @see
*/
void SteamWater_Isr_Timer_10ms_SensingSignal(void)
{
	BOOL bWaterLevelSW = STEAMWATERLEVEL_PORT;

	if(mb_IsSteamWater == bWaterLevelSW)
	{
		munSteamWaterChatteringCount = 0;
	}
	else
	{
		if(munSteamWaterChatteringCount < STEAMWATER_CHATTERING_TIME)
		{
			munSteamWaterChatteringCount++;
		}
		else
		{
			mb_IsSteamWater = bWaterLevelSW;
			munSteamWaterChatteringCount = 0;
		}
	}
}
