/*
 * FlowMeter.c
 *
 *  Created on: 2013. 7. 10.
 *      Author: youngho1.hwang
 */

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"


/* --------------- Define 정의  ---------------  */


/* --------------- Typedef형 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */
static UINT16 munTotalWaterSupplyPulse;
static UINT16 munWaterSupplyPulse;
static BOOL mbPrevWaterSupply ;


/* --------------- 함수 정의  ---------------  */
/**
* @fn void FlowMeter_Init(void)
* FlowMeter 대한 초기화 요청
* @param	없음
* @return	없음
* @see		FlowMeter 초기화
*/
void FlowMeter_Init(void)
{
	munTotalWaterSupplyPulse = 0;
	munWaterSupplyPulse = 0;
	mbPrevWaterSupply = WATERFLOWMETERSW_PORT;
}

/**
* @fn UINT16 FlowMeter_GetWaterSupplyPulse(void)
* * @param	없음
* @return	UINT16				급수량 (Pulse 단위 )
* @see		급수량 값  확인 Pulse 수
*/
UINT16 FlowMeter_GetWaterSupplyPulse(void)
{
	return munWaterSupplyPulse;
}

/**
* @fn void FlowMeter_ClearWaterSupplyPulse(void)
* @param	없음
* @return	없음
* @see		이전에 저장하였던 급수량 값 Clear함.
*/
void FlowMeter_ClearWaterSupplyPulse(void)
{
	munWaterSupplyPulse = CLEAR;
}

/**
* @fn UINT16 FlowMeter_GetTotalWaterSupplyPulse(void)
* * @param	없음
* @return	UINT16				급수량 (Pulse 단위 )
* @see		급수량 값  확인 Pulse 수
*/
UINT16 FlowMeter_GetTotalWaterSupplyPulse(void)
{
	return munTotalWaterSupplyPulse;
}

/**
* @fn void FlowMeter_ClearTotalWaterSupplyPulse(void)
* @param	없음
* @return	없음
* @see		이전에 저장하였던 급수량 값 Clear함.
*/
void FlowMeter_ClearTotalWaterSupplyPulse(void)
{
	munTotalWaterSupplyPulse = 0;
}

/**
* @fn void FlowMeter_RegularControl(void)
* FlowMeter 포트 값 확인하여, 급수량 변경
* @param	없음
* @return	없음
* @see		포트 확인 후, 급수량 변경
*/
void FlowMeter_RegularControl(void)
{
	BOOL bCurWaterSupplyPulse = FALSE;

	// ===============================
	/*
	 * AD port 이므로, 사용에 유의할 것
	 */
#ifndef __SILS__
		WATERFLOWMETERSW_PORT = TRUE;
#endif
	// ===============================

	bCurWaterSupplyPulse = WATERFLOWMETERSW_PORT;

	if ((mbPrevWaterSupply == FALSE) && (bCurWaterSupplyPulse == TRUE))
	{
		munTotalWaterSupplyPulse++;
		munWaterSupplyPulse++;
	}
	else
	{
		;	///< Do nothing
	}

	mbPrevWaterSupply = bCurWaterSupplyPulse;
}
