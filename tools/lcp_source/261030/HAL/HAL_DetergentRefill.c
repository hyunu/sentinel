/*
 * HAL_DetergentRefill.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/DetergentRefill.h"


/**
* @fn void HAL_DetergentRefill_Init(void)
* DetergentRefill 대한 초기화 요청
* @param	없음
* @return	없음
* @see		DetergentRefill 초기화
*/
void HAL_DetergentRefill_Init(void)
{
	DetergentRefill_Init();
}

/**
* @fn BOOL DetergentRefill_IsEmpty(void)
* * @param	없음
* @return	BOOL				Rinse통 상태 값
* @see		Rinse 통 상태 확인
*/
BOOL HAL_DetergentRefill_IsEmpty(void)
{
	return DetergentRefill_IsEmpty();
}

/**
* @fn BOOL HAL_DetergentRefill_Isr_Timer_50ms_SensingSignal(void)
* Rinse 포트 값 확인하여, 통 상태 확인
* @param	없음
* @return	없음
* @see
*/
void HAL_DetergentRefill_Isr_Timer_50ms_SensingSignal(void)
{
	DetergentRefill_Isr_Timer_50ms_SensingSignal();
}
