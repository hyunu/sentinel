/*
 * HAL_RinseRefill.c
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/RinseRefill.h"

/**
* @fn void HAL_RinseRefill_Init(void)
* RinseRefill 대한 초기화 요청
* @param	없음
* @return	없음
* @see		RinseRefill 초기화
*/
void HAL_RinseRefill_Init(void)
{
	RinseRefill_Init();
}


/**
* @fn BOOL HAL_RinseRefill_IsEmpty(void)
* * @param	없음
* @return	BOOL				Rinse통 상태 값
* @see		Rinse 통 상태 확인
*/
BOOL HAL_RinseRefill_IsEmpty(void)
{
	return RinseRefill_IsEmpty();
}

/**
* @fn BOOL HAL_RinseRefill_Isr_Timer_50ms_SensingSignal(void)
* Rinse 포트 값 확인하여, 통 상태 확인
* @param	없음
* @return	없음
* @see
*/
void HAL_RinseRefill_Isr_Timer_50ms_SensingSignal(void)
{
	RinseRefill_Isr_Timer_50ms_SensingSignal();
}
