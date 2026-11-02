/*
 * HAL_AutoDispenser.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"
#include "../Driver/AutoDispenser.h"


/* --------------- Define 정의  ---------------  */


/* --------------- Typedef형 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */


/* --------------- 함수 정의  ---------------  */
/**
* @fn void HAL_AutoDispenser_Init(void)
* AutoDispenser 초기화 함수
* @param 	없음
* @return 	없음
* @see
*/
void HAL_AutoDispenser_Init(void)
{
	AutoDispenser_Init();
}

/**
* @fn void HAL_AutoDispenser_TurnOn(void)
* AutoDispenser Turn On 함수
* @param 	없음
* @return 	없음
* @see
*/
void HAL_AutoDispenser_TurnOn(void)
{
	AutoDispenser_TurnOn();
}

/**
* @fn void HAL_AutoDispenser_TurnOff(void)
* AutoDispenser_TurnOff Turn Off 함수
* @param 	없음
* @return 	없음
* @see
*/
void HAL_AutoDispenser_TurnOff(void)
{
	AutoDispenser_TurnOff();
}

/**
* @fn BOOL HAL_AutoDispenser_IsOn(void)
* 자동세재 상태변수값 Return 함수
* @param	없음
* @return	mb_IsOn		자동세재 상태 값 (1 : On, 0 : Off)
* @see
*/
BOOL HAL_AutoDispenser_IsOn(void)
{
	return AutoDispenser_IsOn();
}

/**
* @fn void HAL_AutoDispenser_SetDirectionCCW(void)
* 자동세재 회전방향 설정 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	없음
* @see
*/
void HAL_AutoDispenser_SetDirectionCCW(void)
{
	AutoDispenser_SetDirectionCCW();
}

/**
* @fn void HAL_AutoDispenser_SetDirectionCW(void)
* 자동세재 회전방향 설정 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	없음
* @see
*/
void HAL_AutoDispenser_SetDirectionCW(void)
{
	AutoDispenser_SetDirectionCW();
}

/**
* @fn BOOL HAL_AutoDispenser_IsDirectionCCW(void)
* 자동세재 회전방향 Return 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	bDirectionCCW	자동세재 회전방향
* @see
*/
BOOL HAL_AutoDispenser_IsDirectionCCW(void)
{
	return AutoDispenser_IsDirectionCCW();
}

/**
* @fn UINT8 AutoDispenser_GetDetergentPulse(void)
* 자동세재 현재 세재량 Return 함수
* @param	없음
* @return	UINT16				세제량 (Pulse 단위 )
* @see		세제량 값  확인 Pulse 수
*/
UINT8 HAL_AutoDispenser_GetDetergentPulse(void)
{
	return AutoDispenser_GetDetergentPulse();
}

/**
* @fn void AutoDispenser_ClearDetergentPulse(void)
* 자동세재 현재 세재량 Clear 함수
* @param	없음
* @return	없음
* @see		이전에 저장하였던 세레량 값 Clear함.
*/
void HAL_AutoDispenser_ClearDetergentPulse(void)
{
	AutoDispenser_ClearDetergentPulse();
}

/**
* @fn void void AutoDispenser_SetTargetDetergentPulse(UINT8 ucTargetPulse)
* 자동세재 Target 세재량 설정 함수
* @param	ucTargetPulse		Target Pulse
* @return	없음
* @see
*/
void HAL_AutoDispenser_SetTargetDetergentPulse(UINT8 ucTargetPulse)
{
	AutoDispenser_SetTargetDetergentPulse(ucTargetPulse);
}

/**
* @fn void HAL_AutoDispenser_StartCheckingStatus(void)
* 자동 디스펜서 모듈 유무 확인 시작 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_AutoDispenser_StartCheckingStatus(void)
{
	AutoDispenser_StartCheckingStatus();
}

/**
* @fn BOOL HAL_AutoDispenser_IsCompleteCheckingStatus(void)
*  자동 디스펜서 모듈 유무 확인 완료.
* @param	 없음
* @return	BOOL	자동 디스펜서 모듈 유무 확인 완료시 TRUE, 미 완료 : FALSE.
* @see		없음.
*/
BOOL HAL_AutoDispenser_IsCompleteCheckingStatus(void)
{
	return AutoDispenser_IsCompleteCheckingStatus();
}

/**
* @fn T_E_AutoDispenserStatus HAL_AutoDispenser_GetAutoDispenserStatus(void)
*  자동 디스펜서 모듈 유무.
* @param	 없음
* @return	T_E_AutoDispenserStatus	자동 디스펜서 모듈 유무
* @see		없음.
*/
T_E_AutoDispenserStatus HAL_AutoDispenser_GetAutoDispenserStatus(void)
{
	return AutoDispenser_GetAutoDispenserStatus();
}

/**
* @fn void HAL_AutoDispenser_RegularControl(void)
* 자동 디스펜서 모듈 유무 확인 함수, Regular Control에서 Main 주기마다 호출
* @param	없음
* @return	없음
* @see
*/
void HAL_AutoDispenser_RegularControl(void)
{
	AutoDispenser_RegularControl();
}

/**
* @fn void AutoDispenser_ISR_External_Pulse(void)
* 외부 Interrupt 함수, 외부에서 신호가 올 때마다 호출되는 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_AutoDispenser_ISR_External_Pulse(void)
{
	AutoDispenser_ISR_External_Pulse();
}
