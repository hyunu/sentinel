/*
 * HAL_DrainMotor_DC.c
 *
 *  Created on: 2013. 7. 31.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/DrainMotor_DC.h"


/**
* @fn UINT16 HAL_DrainMotor_GetCurRPM(void)
* DrainMotor 현재 RPM 값 Return 함수 (DC 에서만 사용)
* @param	없음
* @return	DrainMotor_DC_GetCurRPM()		Drain Motor 현재 RPM
* @see
*/
UINT16 HAL_DrainMotor_GetCurRPM(void)
{
	return DrainMotor_DC_GetCurRPM();
}

/**
* @fn void HAL_DrainMotor_SetCurRPM(UINT16 unCurRPM)
* DrainMotor 현재 RPM 설정 함수 (DC 에서만 사용)
* @param	unCurRPM		현재 RPM
* @return	없음
* @see
*/
void HAL_DrainMotor_SetCurRPM(UINT16 unCurRPM)
{
    DrainMotor_DC_SetCurRPM(unCurRPM);
}

/**
* @fn UINT16 HAL_DrainMotor_GetTarRPM(void)
* DrainMotor Target RPM 값 Return 함수 (DC 에서만 사용)
* @param	없음
* @return	DrainMotor_DC_GetTarRPM()		Drain Motor Target RPM
* @see
*/
UINT16 HAL_DrainMotor_GetTarRPM(void)
{
	return DrainMotor_DC_GetTarRPM();
}

/**
* @fn void HAL_DrainMotor_SetTarRPM(UINT16 unRPM)
* DrainMotor Target RPM 설정 함수 (DC 에서만 사용)
* @param	unRPM		Target RPM
* @return	없음
* @see
*/
void HAL_DrainMotor_SetTarRPM(UINT16 unRPM)
{
	DrainMotor_DC_SetTarRPM(unRPM);
}

/**
* @fn UINT16 HAL_DrainMotor_GetRequestRPM(void)
* DrainMotor Request RPM 값 Return 함수 (DC 에서만 사용)
* @param	없음
* @return	DrainMotor_DC_GetRequestRPM()		Drain Motor Request RPM
* @see
*/
UINT16 HAL_DrainMotor_GetRequestRPM(void)
{
	return DrainMotor_DC_GetRequestRPM();
}

/**
* @fn void HAL_DrainMotor_SetRequestRPM(UINT16 unReqRPM)
* DrainMotor Request RPM 설정 함수 (DC 에서만 사용)
* @param	unReqRPM		Request RPM
* @return	없음
* @see
*/
void HAL_DrainMotor_SetRequestRPM(UINT16 unReqRPM)
{
    DrainMotor_DC_SetRequestRPM(unReqRPM);
}

/**
* @fn UINT16 HAL_DrainMotor_GetMotorCurrent(void)
* DrainMotor Motor Current 반환 함수
* @param	없음
* @return	DrainMotor_GetMotorCurrent()		Motor Current
* @see
*/
UINT16 HAL_DrainMotor_GetMotorCurrent(void)
{
	return DrainMotor_DC_GetMotorCurrent();
}

/**
* @fn void HAL_DrainMotor_SetMotorCurrent(UINT16 unCurrent)
* DrainMotor Motor Current 설정 함수
* @param	unCurrent		Motor Current
* @return	없음
* @see
*/
void HAL_DrainMotor_SetMotorCurrent(UINT16 unCurrent)
{
    DrainMotor_DC_SetMotorCurrent(unCurrent);
}

/**
* @fn UINT16 HAL_DrainMotor_GetMotorWatt(void)
* DrainMotor Motor Watt 반환 함수
* @param	없음
* @return	DrainMotor_DC_GetMotorWatt()		Motor Watt
* @see
*/
UINT16 HAL_DrainMotor_GetMotorWatt(void)
{
	return DrainMotor_DC_GetMotorWatt();
}

/**
* @fn void HAL_DrainMotor_SetMotorWatt(UINT16 unWatt)
* DrainMotor Motor Watt 설정 함수
* @param	unWatt			Motor Watt
* @return	없음
* @see
*/
void HAL_DrainMotor_SetMotorWatt(UINT16 unWatt)
{
	DrainMotor_DC_SetMotorWatt(unWatt);
}

/**
* @fn void HAL_DrainMotor_Init(void)
* DrainMotor 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_DrainMotor_Init(void)
{
	DrainMotor_DC_Init();
}

/**
* @fn void HAL_DrainMotor_TurnOn(void)
* DrainMotor Turn On 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_DrainMotor_TurnOn(void)
{
	DrainMotor_DC_TurnOn();
}

/**
* @fn void HAL_DrainMotor_TurnOff(void)
* DrainMotor Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_DrainMotor_TurnOff(void)
{
	DrainMotor_DC_TurnOff();
}

/**
* @fn BOOL HAL_DrainMotor_IsOn(void)
* DrainMotor 상태변수값 Return 함수
* @param	없음
* @return	DrainMotor_DC_IsOn()		DrainMotor 상태 값 (1 : On, 0 : Off)
* @see
*/
BOOL HAL_DrainMotor_IsOn(void)
{
	return DrainMotor_DC_IsOn();
}

/**
* @fn void HAL_DrainMotor_DirectionCCW(void)
* DrainMotor 회전방향 설정 함수 (CCW : 1, CW : 0) (DC 에서만 사용)
* @param	없음
* @return	없음
* @see
*/
void HAL_DrainMotor_DirectionCCW(void)
{
	DrainMotor_DC_DirectionCCW();
}

/**
* @fn void HAL_DrainMotor_DirectionCW(void)
* DrainMotor 회전방향 설정 함수 (CCW : 1, CW : 0) (DC 에서만 사용)
* @param	없음
* @return	없음
* @see
*/
void HAL_DrainMotor_DirectionCW(void)
{
	DrainMotor_DC_DirectionCW();
}

/**
* @fn BOOL HAL_DrainMotor_IsDirectionCCW(void)
* DrainMotor 회전방향 Return 함수 (CCW : 1, CW : 0) (DC 에서만 사용)
* @param	없음
* @return	DrainMotor_DC_IsDirectionCCW()		Drain Motor Direction
* @see
*/
BOOL HAL_DrainMotor_IsDirectionCCW(void)
{
	return DrainMotor_DC_IsDirectionCCW();
}

/**
* @fn UINT16 HAL_DrainMotor_GetMotorAverageCurrent(void)
* DrainMotor Motor 평균 전류값 Return 함수
* @param	없음
* @return	DrainMotor_DC_GetMotorAverageCurrent()		DrainMotor 평균 전류값
* @see
*/
UINT16 HAL_DrainMotor_GetMotorAverageCurrent(void)
{
	return DrainMotor_DC_GetMotorAverageCurrent();
}

/**
* @fn void HAL_DrainMotor_RegularControl(void)
* DrainMotor 평균 전류값 계산 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_DrainMotor_RegularControl(void)
{
	DrainMotor_DC_RegularControl();
}
