/*
 * HAL_VarioMotor.c
 *
 *  Created on: 2013. 7. 29.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/VarioMotor.h"


/**
* @fn void HAL_VarioMotor_RequestToFindBasePoint(void)
* Vario 기준점 찾기 요청
* @param	없음
* @return	없음
* @see		Vario 모터 기준점 찾기 요청
*/
void HAL_VarioMotor_RequestToFindBasePoint(void)
{
	VarioMotor_RequestToFindBasePoint();
}

/**
* @fn void HAL_VarioMotor_RequestToRotateVarioPosition(T_E_VarioStatus TargetVarioPosition)
* Vario 초기화 후, Target 변경 요청
* @param	T_E_VarioMotorPosition TargetVarioPosition 타겟 노즐 위치
* @return	없음
* @see		Vario TargetNozzle 변경 요청
*/
void HAL_VarioMotor_RequestToRotateVarioPosition(T_E_VarioStatus TargetVarioPosition)
{
	VarioMotor_RequestToRotateVarioPosition(TargetVarioPosition);
}

/**
* @fn void HAL_VarioMotor_RequestToStop(void)
* Vario 모터  정지 요청
* @param	없음
* @return	없음
* @see		Vario 모터  정지 요청
*/
void HAL_VarioMotor_RequestToStop(void)
{
	VarioMotor_RequestToStop();
}


/**
* @fn void HAL_VarioMotor_RequestToResume(void)
* Vario모터  재시작 요청
* @param	없음
* @return	없음
* @see		Vario 모터 동작 재개 요청(이전 요청값으로 저장)
*/
void HAL_VarioMotor_RequestToResume(void)
{
	VarioMotor_RequestToResume();
}

/**
* @fn void HAL_VarioMotor_RequestToSetVarioPosition(T_E_VarioStatus eVarioPosition)
* 현재 Vario 위치 설정 요청
* @param							T_E_VarioStatus eVarioPosition Vario 설정 위치
* @return	없음
* @see
*/
void HAL_VarioMotor_RequestToSetVarioPosition(T_E_VarioStatus eVarioPosition)
{
	VarioMotor_RequestToSetVarioPosition(eVarioPosition);
}

/**
* @fn void HAL_VarioMotor_RegularControl(void)
* concurrent 에서 매 주기마다 호출되는 함수 (요청 값에 따라 실행하는 함수가 달라진다.)
* @param	없음
* @return	없음
* @see		main 주기마다 실행하는 함수
*/
void HAL_VarioMotor_RegularControl(void)
{
	VarioMotor_RegularControl();
}

/**
* @fn void HAL_VarioMotor_Isr_Timer_50ms_CheckTimer(void)
* 50ms마다 호출되는 함수
* @param	없음
* @return	없음
* @see		50ms 주기마다 실행하는 함수 - 기준점 찾을때, Cam 3축의 ON 시간을 측정하기 위한 변수.
*/
void HAL_VarioMotor_Isr_Timer_50ms_CheckTimer(void)
{
	VarioMotor_Isr_Timer_50ms_CheckTimer();
}

/**
* @fn void HAL_VarioMotor_Isr_Timer_50ms_SensingSignal(void)
* 50ms마다 호출되는 함수
* @param	없음
* @return	없음
* @see		50ms 주기마다 실행하는 함수
* 		Vario SW 신호확인하여 Edge판단하는 함수 호출한다.
*/
void HAL_VarioMotor_Isr_Timer_50ms_SensingSignal(void)
{
	VarioMotor_Isr_Timer_50ms_SensingSignal();
}

/**
* @fn T_E_VarioMotorState HAL_VarioMotor_GetState(void)
* Vario모터 현재 state 상태 값  요청
* @param	없음
* @return	Vario모터 현재 state 상태 값
* @see		Vario모터 현재 state 상태 값  요청
*/
T_E_VarioMotorState HAL_VarioMotor_GetState(void)
{
	return VarioMotor_GetState();
}

/**
* @fn T_E_VarioMotorRequest HAL_VarioMotor_GetCurRequest(void)
* 현재 Vario Request 상태
* @param		 없음
* @return	T_E_VarioMotorRequest		Vario Request 상태
* @see		없음.
*/
T_E_VarioMotorRequest HAL_VarioMotor_GetCurRequest(void)
{
	return VarioMotor_GetCurRequest();
}

/**
* @fn T_E_VarioStatus HAL_VarioMotor_GetCurVarioPosition(void)
* Vario모터 현재 state 상태 값  요청
* @param	없음
* @return	Vario모터 현재 Nozzle상태 값
* @see		Vario모터 현재 Nozzle상태 값  요청
*/
T_E_VarioStatus HAL_VarioMotor_GetCurVarioPosition(void)
{
	return VarioMotor_GetCurVarioPosition();
}

/**
* @fn T_E_VarioStatus HAL_VarioMotor_GetTarVarioPosition(void)
* Vario모터 현재 state 상태 값  요청
* @param	없음
* @return	Vario모터 Target Nozzle상태 값
* @see		Vario모터 Target Nozzle상태 값  요청
*/
T_E_VarioStatus HAL_VarioMotor_GetTarVarioPosition(void)
{
	return VarioMotor_GetTarVarioPosition();
}

/**
* @fn BOOL HAL_VarioMotor_IsComplete_FindBasePoint(void)
* Vario모터 기준값 찾기 동작 완료 여부 확인
* @param	없음
* @return	Vario모터 기준값 찾기 동작 완료 여부
* @see		Vario모터 기준값 찾기 동작 완료 여부 확인
*/
BOOL HAL_VarioMotor_IsComplete_FindBasePoint(void)
{
	return VarioMotor_IsComplete_FindBasePoint();
}

/**
* @fn BOOL HAL_VarioMotor_IsComplete_MoveTargetPos(void)
* Vario모터 Target Nozzle 변경 동작 완료 여부 확인
* @param	없음
* @return	Vario모터 Target Nozzle 변경 동작 완료 여부
* @see		Vario모터 Target Nozzle 변경 동작 완료 여부 확인
*/
BOOL HAL_VarioMotor_IsComplete_MoveTargetPos(void)
{
	return VarioMotor_IsComplete_MoveTargetPos();
}

/**
* @fn BOOL VarioMotor_IsFault_MoveTargetPos(void)
* Target 이동 동작 완료 확인.
* @param		 없음
* @return	BOOL	Target 이동 동작완료시 FALSE, 미 완료 : TRUE.
* @see		없음.
*/
BOOL HAL_VarioMotor_IsFault_MoveTargetPos(void)
{
	return VarioMotor_IsFault_MoveTargetPos();
}

/**
* @fn BOOL HAL_VarioMotor_IsOn(void)
* Vario 모터 상태 확인 함수
* @param	없음
* @return	BOOL 모터 상태 값
* @see		Vario 모터 상태 값을 return 해준다.
*/
BOOL HAL_VarioMotor_IsOn(void)
{
	return VarioMotor_IsOn();
}

/**
* @fn void HAL_VarioMotor_Init(void)
* Vario 초기화 함수
* @param	없음
* @return	없음
* @see		Vario 모터 상태변수 초기화 해준다.
*/
void HAL_VarioMotor_Init(void)
{
	VarioMotor_Init();
}

/**
* @fn T_E_VarioSWEdge HAL_VarioMotor_GetSwitchState(void)
* 현재 Vario Switch 상태
* @param		 없음
* @return	T_E_VarioSWEdge		Vario Switch 상태
* @see		없음.
*/
T_E_VarioSWEdge HAL_VarioMotor_GetSwitchState(void)
{
	return VarioMotor_GetSwitchState();
}

UINT8 HAL_VarioMotor_GetVarioSWCheckCount(void)
{
	return VarioMotor_GetVarioSWCheckCount();
}

void HAL_VarioMotor_ClearVarioSWCheckCount(void)
{
	VarioMotor_ClearVarioSWCheckCount();
}

/**
* @fn void HAL_VarioMotor_SetFirstFindBasePointFlag(void)
* 최초 FindBasePoint 동작 여부 Flag 설정
* @param	 없음
* @return	없음
* @see		없음.
*/
void HAL_VarioMotor_SetFirstFindBasePointFlag(BOOL bVarioInitFlag)
{
	VarioMotor_SetFirstFindBasePointFlag(bVarioInitFlag);
}

/**
* @fn UINT8 HAL_VarioMotor_GetFirstVarioInitTime(void)
* 최초 Vario 초기화 동작시간 반환 함수
* @param	 없음
* @return	UINT8		mucFirstVarioInitTime
* @see		없음.
*/
UINT8 HAL_VarioMotor_GetFirstVarioInitTime(void)
{
	return VarioMotor_GetFirstVarioInitTime();
}