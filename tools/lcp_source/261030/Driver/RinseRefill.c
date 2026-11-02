/*
 * RinseRefill.c
 *
 *  Created on: 2013. 7. 10.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

#define		RINSEREFILLCHECK_TIME		60		/* 60 * 50ms = 3sec */

static BOOL mb_IsEmpty;
static UINT16 munRinseRefillCount;

/**
* @fn void RinseRefill_Init(void)
* RinseRefill 대한 초기화 요청
* @param	없음
* @return	없음
* @see		RinseRefill 초기화
*/
void RinseRefill_Init(void)
{
	munRinseRefillCount = CLEAR;
	mb_IsEmpty = FALSE;
}

/**
* @fn BOOL RinseRefill_IsEmpty(void)
* * @param	없음
* @return	BOOL				Rinse통 상태 값
* @see		Rinse 통 상태 확인
*/
BOOL RinseRefill_IsEmpty(void)
{
	return mb_IsEmpty;
}

/**
* @fn BOOL RinseRefill_Isr_Timer_50ms_SensingSignal(void)
* Rinse 포트 값 확인하여, 통 상태 확인
* @param	없음
* @return	없음
* @see
*/
void RinseRefill_Isr_Timer_50ms_SensingSignal(void)
{
	if (RINSEREFILLSW_PORT == FALSE)
	{
		if (munRinseRefillCount > 0)
		{
			munRinseRefillCount--;
		}
		else
		{
			;		///< Do nothing
		}

		if(munRinseRefillCount == 0)
		{
			mb_IsEmpty = FALSE;
		}
		else
		{
			;		///< Do nothing
		}
	}
	else
	{
		if (munRinseRefillCount < RINSEREFILLCHECK_TIME)
		{
			munRinseRefillCount++;
		}
		else
		{
			;		///< Do nothing
		}

		if(munRinseRefillCount >= RINSEREFILLCHECK_TIME)
		{
			mb_IsEmpty = TRUE;
		}
		else
		{
			;		///< Do nothing
		}
	}
}
