/*
 * SaltRefill.c
 *
 *  Created on: 2013. 7. 10.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

#define		SALTREFILLCHECK_TIME		60		/* 60 * 50ms = 3sec */

static BOOL mb_IsEmpty;
static UINT16 munSaltRefillCount;

/**
* @fn void SaltRefill_Init(void)
* SaltRefill 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SaltRefill 초기화
*/
void SaltRefill_Init(void)
{
	munSaltRefillCount = CLEAR;
	mb_IsEmpty = FALSE;
}

/**
* @fn BOOL SaltRefill_IsEmpty(void)
* * @param	없음
* @return	BOOL				Salt통 상태 값
* @see		Salt 통 상태 확인
*/
BOOL SaltRefill_IsEmpty(void)
{
	return mb_IsEmpty;
}

/**
* @fn BOOL SaltRefill_Isr_Timer_50ms_SensingSignal(void)
* Salt 포트 값 확인하여, 통 상태 확인
* @param	없음
* @return	없음
* @see
*/
void SaltRefill_Isr_Timer_50ms_SensingSignal(void)
{
	if (SALTREFILLSW_PORT == TRUE)
	{
		if (munSaltRefillCount > 0)
		{
			munSaltRefillCount--;
		}
		else
		{
			mb_IsEmpty = FALSE;
		}
	}
	else
	{
		if (munSaltRefillCount < SALTREFILLCHECK_TIME)
		{
			munSaltRefillCount++;
		}
		else
		{
			mb_IsEmpty = TRUE;
		}
	}
}
