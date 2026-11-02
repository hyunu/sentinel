/*
 * Sensor_IPMTemperature.c
 *
 *  Created on: 2014. 1. 3.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"


static UINT8 mucFinalIPMTempValue;
static UINT8 mucMaxIPMTempValue;


/**
* @fn void Sensor_IPMTemperature_SetValue(UINT8 ucValue)
* Sensor_IPMTemperature 평균값 설정 함수
* @param	ucValue		IPMTemperature 평균값
* @return	없음
* @see
*/
void Sensor_IPMTemperature_SetValue(UINT8 ucValue)
{
	if(mucMaxIPMTempValue < ucValue)
	{
		mucMaxIPMTempValue = ucValue;
	}
	else
	{
		;
	}

	mucFinalIPMTempValue = ucValue;
}

/**
* @fn void Sensor_IPMTemperature_Init(void)
* Sensor_IPMTemperature 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void Sensor_IPMTemperature_Init(void)
{
	mucFinalIPMTempValue = CLEAR;
}

/**
* @fn UINT8 Sensor_IPMTemperature_GetTemp(void)
* Sensor_IPMTemperature 변환값 Return 함수
* @param	없음
* @return	unReturn		IPMTemperature 변환값
* @see
*/
UINT8 Sensor_IPMTemperature_GetTemp(void)
{
	return mucFinalIPMTempValue;
}

/**
* @fn UINT8 Sensor_IPMTemperature_GetMaxTemp(void)
* Max IPM 온도 Return 함수
* @param	없음
* @return	unReturn		IPMMaxTemperature 변환값
* @see
*/
UINT8 Sensor_IPMTemperature_GetMaxTemp(void)
{
	return mucMaxIPMTempValue;
}
