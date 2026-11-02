/*
 * HAL_FlowMeter.c
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/FlowMeter.h"


/**
* @fn void HAL_FlowMeter_init(void)
* FlowMeter 대한 초기화 요청
* @param	없음
* @return	없음
* @see		FlowMeter 초기화
*/
void HAL_FlowMeter_Init(void)
{
	FlowMeter_Init();
}

/**
* @fn BOOL HAL_FlowMeter_GetWaterSupplyPulse (void)
* * @param	없음
* @return	UINT16				급수량 (Pulse 단위 )
* @see		급수량 값  확인 Pulse 수
*/
UINT16 HAL_FlowMeter_GetWaterSupplyPulse(void)
{
	return FlowMeter_GetWaterSupplyPulse();
}
/**
* @fn BOOL HAL_FlowMeter_ClearWaterSupplyPulse(void)
* @param	없음
* @return	없음
* @see		이전에 저장하였던 급수량 값 Clear함.
*/
void HAL_FlowMeter_ClearWaterSupplyPulse(void)
{
	FlowMeter_ClearWaterSupplyPulse();
}

/**
* @fn UINT16 FlowMeter_GetTotalWaterSupplyPulse(void)
* * @param	없음
* @return	UINT16				급수량 (Pulse 단위 )
* @see		급수량 값  확인 Pulse 수
*/
UINT16 HAL_FlowMeter_GetTotalWaterSupplyPulse(void)
{
	return FlowMeter_GetTotalWaterSupplyPulse();
}

/**
* @fn void FlowMeter_ClearTotalWaterSupplyPulse(void)
* @param	없음
* @return	없음
* @see		이전에 저장하였던 급수량 값 Clear함.
*/
void HAL_FlowMeter_ClearTotalWaterSupplyPulse(void)
{
	FlowMeter_ClearTotalWaterSupplyPulse();
}

/**
* @fn BOOL HAL_FlowMeter_RegularControl(void)
* FlowMeter 포트 값 확인하여, 급수량 변경
* @param	없음
* @return	없음
* @see		포트 확인 후, 급수량 변경
*/
void HAL_FlowMeter_RegularControl(void)
{
	FlowMeter_RegularControl();
}
