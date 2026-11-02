/*
 * DoorLatch.c
 *
 *  Created on: 2013. 7. 8.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"


#define		DOORLATCH_DC_CHECK_TIME				(65)		/* 2ms * 65 = 130ms */


static BOOL mb_IsOpen;
static BOOL mb_IsDoorLatch_1;
static UINT16 munDoorLatch_1_Count;
static BOOL mb_IsDoorLatch_2;
static UINT16 munDoorLatch_2_Count;


/**
* @fn void DoorLatch_Init(void)
* DoorLatch에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		DoorLatch 초기화
*/
void DoorLatch_Init(void)
{
	mb_IsOpen = FALSE;
	mb_IsDoorLatch_1 = FALSE;
	munDoorLatch_1_Count = 0;
	mb_IsDoorLatch_2 = FALSE;
	munDoorLatch_2_Count = 0;
}

/**
* @fn BOOL DoorLatch_IsOpen(void)
* @param	없음
* @return	BOOL				DoorLatch Open or Close 상태 값
* @see		DoorLatch Open 상태 확인
*/
BOOL DoorLatch_IsOpen(void)
{
	return mb_IsOpen;
}

/**
* @fn BOOL DoorLatch_IsOpen_DoorLatch_1(void)
* @param	없음
* @return	BOOL				DoorLatch 1 Open or Close 상태 값
* @see		DoorLatch 1 Open 상태 확인
*/
BOOL DoorLatch_IsOpen_DoorLatch_1(void)
{
	return mb_IsDoorLatch_1;
}

/**
* @fn BOOL DoorLatch_IsOpen_DoorLatch_2(void)
* @param	없음
* @return	BOOL				DoorLatch 2 Open or Close 상태 값
* @see		DoorLatch 2 Open 상태 확인
*/
BOOL DoorLatch_IsOpen_DoorLatch_2(void)
{
	return mb_IsDoorLatch_2;
}

/**
* @fn void DoorLatch_Isr_2ms_SensingSignal(void)
* Door Status 갱신, Time critical 하므로 2ms 인터럽에서 호출
* @param	없음
* @return	없음
* @see		2ms마다 Port 입력 값 확인하여 Door Open 상태 변경. 만약 1초 동안 계속 체크 중이면 Reset 동작.
*/
void DoorLatch_Isr_2ms_SensingSignal(void)
{
	if(DOORSW_DC_PORT1 == FALSE)
	{
		if (munDoorLatch_1_Count < DOORLATCH_DC_CHECK_TIME)
		{
			munDoorLatch_1_Count++;
		}
		else
		{
			mb_IsDoorLatch_1 = FALSE;					// Door Latch 1 Close
		}
	}
	else
	{
		if (munDoorLatch_1_Count > 0)
		{
			munDoorLatch_1_Count--;
		}
		else
		{
			mb_IsDoorLatch_1 = TRUE;					// Door Latch 1 Open
		}
	}

	if(DOORSW_DC_PORT2 == FALSE)
	{
		if (munDoorLatch_2_Count < DOORLATCH_DC_CHECK_TIME)
		{
			munDoorLatch_2_Count++;
		}
		else
		{
			mb_IsDoorLatch_2 = FALSE;					// Door Latch 1 Close
		}
	}
	else
	{
		if (munDoorLatch_2_Count > 0)
		{
			munDoorLatch_2_Count--;
		}
		else
		{
			mb_IsDoorLatch_2 = TRUE;					// Door Latch 1 Open
		}
	}

	// Door SW DC 신호 감지 (Port 2개 사용)함에 따라 Port 신호 모두 FALSE인 경우 Close, 그외 조건은 Open 판단
	if((mb_IsDoorLatch_1 == FALSE) && (mb_IsDoorLatch_2 == FALSE))
	{
		mb_IsOpen = FALSE;					// Door Close
	}
	else
	{
		mb_IsOpen = TRUE;					// Door Open
	}
}
