/*
 * HAL_DoorLatch.c
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/DoorLatch.h"


/**
* @fn void HAL_DoorLatch_Init(void)
* DoorLatch에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		DoorLatch 초기화
*/
void HAL_DoorLatch_Init(void)
{
	DoorLatch_Init();
}

/**
* @fn BOOL HAL_DoorLatch_IsOpen(void)
* * @param	없음
* @return	BOOL				DoorLatch Open or Close 상태 값
* @see		DoorLatch Open 상태 확인
*/
BOOL HAL_DoorLatch_IsOpen(void)
{
	return DoorLatch_IsOpen();
}

/**
* @fn BOOL HAL_DoorLatch_IsOpen_DoorLatch_1(void)
* * @param	없음
* @return	BOOL				DoorLatch 1 Open or Close 상태 값
* @see		DoorLatch 1 Open 상태 확인
*/
BOOL HAL_DoorLatch_IsOpen_DoorLatch_1(void)
{
	return DoorLatch_IsOpen_DoorLatch_1();
}

/**
* @fn BOOL HAL_DoorLatch_IsOpen_DoorLatch_2(void)
* * @param	없음
* @return	BOOL				DoorLatch 2 Open or Close 상태 값
* @see		DoorLatch 2 Open 상태 확인
*/
BOOL HAL_DoorLatch_IsOpen_DoorLatch_2(void)
{
	return DoorLatch_IsOpen_DoorLatch_2();
}

/**
* @fn BOOL HAL_DoorLatch_ISR_TIMER_2ms_SensingSignal(void)
* Door Status 갱신, Time critical 하므로 2ms 인터럽에서 호출
* @param	없음
* @return	없음
* @see		2ms마다 Port 입력 값 확인하여 Door Open 상태 변경.
*/
void HAL_DoorLatch_Isr_Timer_2ms_SensingSignal(void)
{
	DoorLatch_Isr_2ms_SensingSignal();
}
