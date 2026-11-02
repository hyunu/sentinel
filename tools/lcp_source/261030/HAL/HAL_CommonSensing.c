/*
 * HAL_CommonSensing.c
 *
 *  Created on: 2013. 11. 7.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/CommonSensing.h"

/**
* @fn void HAL_CommonSensing_Init(void)
* CommonSensing 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		CommonSensing 초기화
*/

void HAL_CommonSensing_Init(void)
{
	CommonSensing_Init();
}

/**
* @fn void HAL_CommonSensing_ISR_Timer_10ms_DecreaseCount(void)
* Sensing 주기 계산하기 위한 10ms Interrupt
* @param	없음
* @return	없음
* @see		10ms 마다 Decrease Count
*/
void HAL_CommonSensing_ISR_Timer_10ms_DecreaseCount(void)
{
	CommonSensing_ISR_Timer_10ms_DecreaseCount();
}

/**
* @fn void HAL_CommonSensing_RegularControl(void)
* 10ms 마다 Port 값 한 번 Sensing 하여 16 개 data 평균값 계산
* @param	없음
* @return	없음
* @see		16개 data 평균값 계산
*/
void HAL_CommonSensing_RegularControl(void)
{
	CommonSensing_RegularControl();
}
