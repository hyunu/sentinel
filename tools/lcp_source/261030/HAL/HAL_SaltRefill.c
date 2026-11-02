/*
 * HAL_SaltRefill.c
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/SaltRefill.h"

/**
* @fn void HAL_SaltRefill_Init(void)
* SaltRefill 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SaltRefill 초기화
*/
void HAL_SaltRefill_Init(void)
{
	SaltRefill_Init();
}


/**
* @fn BOOL HAL_SaltRefill_IsEmpty(void)
* * @param	없음
* @return	BOOL				Salt통 상태 값
* @see		Salt 통 상태 확인
*/
BOOL HAL_SaltRefill_IsEmpty(void)
{
	return SaltRefill_IsEmpty();
}

/**
* @fn BOOL HAL_SaltRefill_Isr_Timer_50ms_SensingSignal(void)
* Salt 포트 값 확인하여, 통 상태 확인
* @param	없음
* @return	없음
* @see
*/
void HAL_SaltRefill_Isr_Timer_50ms_SensingSignal(void)
{
	SaltRefill_Isr_Timer_50ms_SensingSignal();
}
