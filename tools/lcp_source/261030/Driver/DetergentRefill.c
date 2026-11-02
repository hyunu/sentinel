/*
 * DetergentRefill.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

#define		DETERGENTREFILLCHECK_TIME		60		/* 60 * 50ms = 3sec */

static BOOL mb_IsEmpty;
static UINT16 munDetergentRefillCount;

/**
* @fn void DetergentRefill_Init(void)
* DetergentRefill 대한 초기화 요청
* @param	없음
* @return	없음
* @see		DetergentRefill 초기화
*/
void DetergentRefill_Init(void)
{
	munDetergentRefillCount = CLEAR;
	mb_IsEmpty = FALSE;
}

/**
* @fn BOOL DetergentRefill_IsEmpty(void)
* * @param	없음
* @return	BOOL				Rinse통 상태 값
* @see		Rinse 통 상태 확인
*/
BOOL DetergentRefill_IsEmpty(void)
{
	return mb_IsEmpty;
}

/**
* @fn BOOL DetergentRefill_Isr_Timer_50ms_SensingSignal(void)
* Rinse 포트 값 확인하여, 통 상태 확인
* @param	없음
* @return	없음
* @see
*/
void DetergentRefill_Isr_Timer_50ms_SensingSignal(void)
{
	if (DETERGENTREFILLSW_PORT == TRUE)
	{
		if (munDetergentRefillCount > 0)
		{
			munDetergentRefillCount--;
		}
		else
		{
			;		///< Do nothing
		}

		if(munDetergentRefillCount == 0)
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
		if (munDetergentRefillCount < DETERGENTREFILLCHECK_TIME)
		{
			munDetergentRefillCount++;
		}
		else
		{
			;		///< Do nothing
		}

		if(munDetergentRefillCount >= DETERGENTREFILLCHECK_TIME)
		{
			mb_IsEmpty = TRUE;
		}
		else
		{
			;		///< Do nothing
		}
	}
}
