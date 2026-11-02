/*
 * HAL_HeatDryFan.c
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/HeatDryFan.h"


/**
* @fn void HAL_HeatDryFan_Init(void)
* HeatDryFan 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_HeatDryFan_Init(void)
{
	HeatDryFan_Init();
}

/**
* @fn void HAL_HeatDryFan_TurnOn(void)
* HeatDryFan Turn On 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_HeatDryFan_TurnOn(void)
{
	HeatDryFan_TurnOn();
}

/**
* @fn void HAL_HeatDryFan_TurnOff(void)
* HeatDryFan Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_HeatDryFan_TurnOff(void)
{
	HeatDryFan_TurnOff();
}

/**
* @fn BOOL HAL_HeatDryFan_IsOn(void)
* HeatDryFan 상태변수값 Return 함수
* @param	없음
* @return	HeatDryFan_IsOn()		HeatDryFan 상태 값 (1 : On, 0 : Off)
* @see
*/
BOOL HAL_HeatDryFan_IsOn(void)
{
	return HeatDryFan_IsOn();
}

/**
* @fn UINT16 HAL_HeatDryFan_GetCurRPM(void)
* HeatDryFan 현재 RPM 값 Return 함수
* @param	없음
* @return	HeatDryFan_DC_GetCurRPM()		HeatDryFan 현재 RPM
* @see
*/
UINT16 HAL_HeatDryFan_GetCurRPM(void)
{
	return HeatDryFan_GetCurRPM();
}

/**
* @fn UINT8 HAL_HeatDryFan_GetTarDuty(void)
* HeatDryFan Target Duty 값 Return 함수
* @param	없음
* @return	HeatDryFan_GetTarDuty()		HeatDryFan Target Duty
* @see
*/
UINT8 HAL_HeatDryFan_GetTarDuty(void)
{
	return HeatDryFan_GetTarDuty();
}

/**
* @fn void HAL_HeatDryFan_SetTarDuty(UINT8 ucDuty)
* HeatDryFan Target Duty 설정 함수
* @param	ucDuty		Target Duty
* @return	없음
* @see
*/
void HAL_HeatDryFan_SetTarDuty(UINT8 ucDuty)
{
	HeatDryFan_SetTarDuty(ucDuty);
}

/**
* @fn BOOL HAL_HeatDryFan_IsLockDetecting(void)
* Heat Dry Fan에 대한 Lock 감지 상태 확인
* @param	없음
* @return	BOOL			Lock 감지 상태 값
* @see		HeatDryFan Lock 감지 상태 확인
*/
BOOL HAL_HeatDryFan_IsLockDetecting(void)
{
	return HeatDryFan_IsLockDetecting();
}

/**
* @fn void HAL_HeatDryFan_ClearLockDetecting(void)
* Heat Dry Fan에 대한 Lcok 감지 상태 초기화
* @param	없음
* @return	없음
* @see		HeatDryFan Lock 감지 상태 초기화
*/
void HAL_HeatDryFan_ClearLockDetecting(void)
{
	HeatDryFan_ClearLockDetecting();
}

/**
* @fn BOOL HAL_HeatDryFan_IsRetryStatusAfterLock(void)
* Heat Dry Fan에 대한 Lock 감지 후 재기동 상태 확인
* @param	없음
* @return	BOOL			Lock 감지 후 재기동 상태 값
* @see		HeatDryFan Lock 감지 후 재기동 상태 확인
*/
BOOL HAL_HeatDryFan_IsRetryStatusAfterLock(void)
{
	return HeatDryFan_IsRetryStatusAfterLock();
}

/**
* @fn void HAL_HeatDryFan_RegularControl(void)
* HeatDryFan 제어 함수, Regular Control 에서 Main 주기마다 호출
* @param	없음
* @return	없음
* @see
*/
void HAL_HeatDryFan_RegularControl(void)
{
	HeatDryFan_RegularControl();
}

/**
* @fn void HAL_HeatDryFan_ISR_External_FG(UINT16 unTimerCount)
* 외부 Interrupt 함수, 외부에서 신호가 올 때마다 호출되는 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_HeatDryFan_ISR_External_FG(UINT16 unTimerCount)
{
	HeatDryFan_ISR_External_FG(unTimerCount);
}

/**
* @fn UINT8 HAL_HeatDryFan_Get_Lock_Retry_Count(void)
* Heat Dry Fan에 대한 Lock 감지 횟수 반환 함수
* @param	없음
* @return	UINT8			Lock 감지 횟수 (최대값 3)
*/

UINT8 HAL_HeatDryFan_Get_Lock_Retry_Count(void)
{
	return HeatDryFan_Get_Lock_Retry_Count();
}
