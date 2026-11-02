/*
 * HeatDryDoor.c
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

#define HEATDRYDOOR_CHECK_TIME				(16)		/* 10ms * 16 = 160ms */

static BOOL mb_IsOpen;
static UINT16 HeatDryDoorCount;

/**
* @fn void HeatDryDoor_Init(void)
* Heat Dry Door에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		Heat Dry Door 초기화
*/
void HeatDryDoor_Init(void)
{
	HeatDryDoorCount = CLEAR;
	mb_IsOpen = FALSE;
}

/**
* @fn BOOL HeatDryDoor_IsOpen(void)
* @param	없음
* @return	BOOL				Heat Dry Door Open or Close 상태 값
* @see		Heat Dry Door Open 상태 확인
*/
BOOL HeatDryDoor_IsOpen(void)
{
	return 	mb_IsOpen;
}

/**
* @fn void HeatDryDoor_Isr_10ms_SensingSignal(void)
* Heat Dry Door Status 갱신, Time critical 하므로 10ms 인터럽에서 호출
* @param	없음
* @return	없음
* @see		2ms마다 Port 입력 값 확인하여 Heat Dry Door Open 상태 변경.
*/
void HeatDryDoor_Isr_10ms_SensingSignal(void)
{
	// Heat Dry Door SW 신호 감지 : Port 신호가 FALSE인 경우 Open, 그외 조건은 Close 판단
	if(HEATDRYDOORSW_PORT == FALSE)
	{
		if (HeatDryDoorCount < HEATDRYDOOR_CHECK_TIME)
		{
			HeatDryDoorCount++;
		}
		else
		{
			mb_IsOpen = FALSE;					// Door Close
		}
	}
	else
	{
		if (HeatDryDoorCount > 0)
		{
			HeatDryDoorCount--;
		}
		else
		{
			mb_IsOpen = TRUE;					// Door Open
		}
	}
}
