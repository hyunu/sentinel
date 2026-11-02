/*
 * HAL_Sensor_DCLink.c
 *
 *  Created on: 2013. 7. 27.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/Sensor_DCLink.h"

/**
* @fn void HAL_Sensor_DCLink_Init(void)
* Sensor_DCLink 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		Sensor_DCLink 초기화
*/
void HAL_Sensor_DCLink_Init(void)
{
	Sensor_DCLink_Init();
}

/**
* @fn UINT16 HAL_Sensor_DCLink_GetSumpTemp(void)
* * @param	없음
* @return	UINT8				DC Link 값
* @see		DC Link 값 확인
*/
UINT16 HAL_Sensor_DCLink_GetDCLinkVolt(void)
{
	return Sensor_DCLink_GetDCLinkVolt();
}

/**
* @fn UINT16 HAL_Sensor_DCLink_GetMaxDCLinkVolt(void)
* @param	없음
* @return	UINT16				DC Link Max 값
* @see		DC Link Max 값 확인
*/
UINT16 HAL_Sensor_DCLink_GetMaxDCLinkVolt(void)
{
	return Sensor_DCLink_GetMaxDCLinkVolt();
}

/**
* @fn UINT16 HAL_Sensor_DCLink_GetMinDCLinkVolt(void)
* @param	없음
* @return	UINT16				DC Link Min 값
* @see		DC Link Min 값 확인
*/
UINT16 HAL_Sensor_DCLink_GetMinDCLinkVolt(void)
{
	return Sensor_DCLink_GetMinDCLinkVolt();
}

/**
* @fn double Sensor_DCLink_GetACVoltage(void)
* AC전압 Return 함수
* @param	없음
* @return	AC전압
* @see		AC전압 Return 함수
*/
double HAL_Sensor_DCLink_GetACVoltage(void)
{
	return Sensor_DCLink_GetACVoltage();
}

/**
* @fn void HAL_Sensor_DCLink_RequestACVoltage(void)
* AC전압 측정 시작 요청 함수
* @param	없음
* @return	없음
* @see		AC전압 측정 시작 요청 함수
*/
void HAL_Sensor_DCLink_RequestACVoltage(void)
{
	Sensor_DCLink_RequestACVoltage();
}

/**
* @fn void Sensor_DCLink_IsCompleteACVoltage(void)
* AC전압 측정 완료 여부 확인 함수
* @param	없음
* @return	완료시 True, 미완료시 FALSE
* @see		AC전압 측정 완료 여부 확인 함수
*/
BOOL HAL_Sensor_DCLink_IsCompleteACVoltage(void)
{
	return Sensor_DCLink_IsCompleteACVoltage();
}

/**
* @fn void Sensor_DCLink_RegularControl(void)
* AC전압 측정 동작 함수
* @param	없음
* @return	없음
* @see		AC전압 측정 동작 함수
*/
void HAL_Sensor_DCLink_RegularControl(void)
{
	Sensor_DCLink_RegularControl();
}

/**
* @fn void Sensor_DCLink_Isr_Timer_100ms_CheckTimer(void)
* AC전압 측정 100ms 타이머 감지 인터럽트
* @param	없음
* @return	없음
* @see		AC전압 측정 100ms 타이머 감지 인터럽트
*/
void HAL_Sensor_DCLink_Isr_Timer_100ms_CheckTimer(void)
{
	Sensor_DCLink_Isr_Timer_100ms_CheckTimer();
}

/**
* @fn void HAL_Set_DCLink_AD_Value(UINT16 unTemp)
* Set DCLink AD 설정 함수
* @param	unTemp			DCLink ADC값(12bit) << 4
* @return	없음
* @see
* @remarks	
**/
void HAL_Set_DCLink_AD_Value(UINT16 unTemp)
{
	Set_DCLink_AD_Value(unTemp);
}
