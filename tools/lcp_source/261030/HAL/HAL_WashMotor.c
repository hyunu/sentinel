/*
 * HAL_WashMotor.c
 *
 *  Created on: 2013. 7. 29.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/WashMotor.h"

/**
* @fn void HAL_WashMotor_SetTarRPM(UINT16 unRPM)
* WashMotor Target RPM 설정 함수
* @param	unRPM		Target RPM
* @return	없음
* @see
*/
void HAL_WashMotor_SetTarRPM(UINT16 unRPM)
{
	WashMotor_SetTarRPM(unRPM);
}

/**
* @fn UINT16 HAL_WashMotor_GetCurRPM(void)
* WashMotor 현재 RPM Return 함수
* @param	없음
* @return	WashMotor_GetCurRPM()		현재 RPM
* @see
*/
UINT16 HAL_WashMotor_GetCurRPM(void)
{
	return WashMotor_GetCurRPM();
}

/**
* @fn void HAL_WashMotor_SetCurRPM(UINT16 unCurRPM)
* WashMotor 현재 RPM 설정 함수
* @param	unCurRPM			현재 RPM
* @return	없음
* @see
*/
void HAL_WashMotor_SetCurRPM(UINT16 unCurRPM)
{
    WashMotor_SetCurRPM(unCurRPM);
}

/**
* @fn UINT16 HAL_WashMotor_GetTarRPM(void)
* WashMotor Target RPM 반환 함수
* @param	없음
* @return	WashMotor_GetTarRPM()		Target RPM
* @see
*/
UINT16 HAL_WashMotor_GetTarRPM(void)
{
	return WashMotor_GetTarRPM();
}

/**
* @fn UINT16 HAL_WashMotor_GetRequestRPM(void)
* WashMotor Request RPM 반환 함수
* @param	없음
* @return	WashMotor_GetRequestRPM()		Request RPM
* @see
*/
UINT16 HAL_WashMotor_GetRequestRPM(void)
{
	return WashMotor_GetRequestRPM();
}

/**
* @fn void HAL_WashMotor_SetRequestRPM(UINT16 unReqRPM)
* WashMotor Request RPM 설정 함수
* @param	unReqRPM			Request RPM
* @return	없음
* @see
*/
void HAL_WashMotor_SetRequestRPM(UINT16 unReqRPM)
{
	WashMotor_SetRequestRPM(unReqRPM);
}

/**
* @fn UINT16 HAL_WashMotor_GetMotorCurrent(void)
* WashMotor Motor Current 반환 함수
* @param	없음
* @return	WashMotor_GetMotorCurrent()		Motor Current
* @see
*/
UINT16 HAL_WashMotor_GetMotorCurrent(void)
{
	return WashMotor_GetMotorCurrent();
}

/**
* @fn void HAL_WashMotor_SetMotorCurrent(UINT16 unCurrent)
* WashMotor Motor Current 설정 함수
* @param	unCurrent			Motor Current
* @return	없음
* @see
*/
void HAL_WashMotor_SetMotorCurrent(UINT16 unCurrent)
{
    WashMotor_SetMotorCurrent(unCurrent);
}

/**
* @fn UINT16 HAL_WashMotor_GetMotorWatt(void)
* WashMotor Motor Watt 반환 함수
* @param	없음
* @return	WashMotor_GetMotorWatt()		Motor Watt
* @see
*/
UINT16 HAL_WashMotor_GetMotorWatt(void)
{
	return WashMotor_GetMotorWatt();
}

/**
* @fn void HAL_WashMotor_SetMotorWatt(UINT16 unWatt)
* WashMotor Motor Watt 설정 함수
* @param	unWatt			Motor Watt
* @return	없음
* @see
*/
void HAL_WashMotor_SetMotorWatt(UINT16 unWatt)
{
	WashMotor_SetMotorWatt(unWatt);
}

/**
* @fn void HAL_WashMotor_TurnOn(void)
* WashMotor Turn On 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_WashMotor_TurnOn(void)
{
	WashMotor_TurnOn();
}

/**
* @fn void HAL_WashMotor_TurnOff(void)
* WashMotor Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_WashMotor_TurnOff(void)
{
	WashMotor_TurnOff();
}

/**
* @fn BOOL HAL_WashMotor_IsOn(void)
* WashMotor 상태 Return 함수
* @param	없음
* @return	WashMotor_IsOn()	상태값 (1 : On, 0 : Off)
* @see
*/
BOOL HAL_WashMotor_IsOn(void)
{
	return WashMotor_IsOn();
}

/**
* @fn void HAL_WashMotor_SetIntermitWashFlag(void)
* WashMotor 간헐세척 동작 설정 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_WashMotor_SetIntermitWashFlag(void)
{
	WashMotor_SetIntermitWashFlag();
}

/**
* @fn void HAL_WashMotor_SetNormalFlag(void)
* WashMotor 일반세척 동작 설정 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_WashMotor_SetNormalFlag(void)
{
	WashMotor_SetNormalWashFlag();
}

/**
* @fn void HAL_WashMotor_Init(void)
* WashMotor 변수 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_WashMotor_Init(void)
{
	WashMotor_Init();
}

/**
* @fn BOOL HAL_WashMotor_IsLEFlagSet(void)
* WashMotor LE Flag 값 Return 함수
* @param	없음
* @return	WashMotor_IsLEFlagSet()		LE 발생 여부 (1 : 발생, 0 : 미 발생)
* @see
*/
BOOL HAL_WashMotor_IsLEFlagSet(void)
{
	return WashMotor_IsLEFlagSet();
}

/**
* @fn void HAL_WashMotor_ClearLEFlag(void)
* WashMotor LE Flag 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_WashMotor_ClearLEFlag(void)
{
	WashMotor_ClearLEFlag();
}

/**
* @fn void HAL_WashMotor_SetLEFlag(void)
* WashMotor LE Flag 설정 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_WashMotor_SetLEFlag(void)
{
	WashMotor_SetLEFlag();
}

/**
* @fn UINT16 HAL_WashMotor_GetMotorAverageCurrent(void)
* WashMotor Motor 평균 전류값 Return 함수
* @param	없음
* @return	WashMotor_GetMotorAverageCurrent()		WashMotor 평균 전류값
* @see
*/
UINT16 HAL_WashMotor_GetMotorAverageCurrent(void)
{
	return WashMotor_GetMotorAverageCurrent();
}

/**
* @fn void HAL_WashMotor_RegularControl(void)
* WashMotor 평균 전류값 계산 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_WashMotor_RegularControl(void)
{
	WashMotor_RegularControl();
}
