/*
 * HAL_Sensor_IPMTemperature.c
 *
 *  Created on: 2014. 1. 3.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/Sensor_IPMTemperature.h"

/**
* @fn void HAL_Sensor_IPMTemperature_Init(void)
* Sensor_IPMTemperature 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void HAL_Sensor_IPMTemperature_Init(void)
{
	Sensor_IPMTemperature_Init();
}

/**
* @fn UINT8 HAL_Sensor_IPMTemperature_GetTemp(void)
* Sensor_IPMTemperature 변환값 Return 함수
* @param	없음
* @return	Sensor_IPMTemperature_GetTemp()		IPMTemperature 변환값
* @see
*/
UINT8 HAL_Sensor_IPMTemperature_GetTemp(void)
{
	return Sensor_IPMTemperature_GetTemp();
}

/**
* @fn UINT8 HAL_Sensor_IPMTemperature_GetMaxTemp(void)
* IPM Max 온도 변환값 Return 함수
* @param	없음
* @return	Sensor_IPMTemperature_GetMaxTemp()		IPMMaxTemperature 변환값
* @see
*/
UINT8 HAL_Sensor_IPMTemperature_GetMaxTemp(void)
{
	return Sensor_IPMTemperature_GetMaxTemp();
}

/**
* @fn void HAL_Sensor_IPMTemperature_SetValue(UINT8 ucValue)
* Sensor_IPM Temperature 설정 함수
* @param	ucValue		IPM Temperature 설정값
* @return	없음
* @see
*/
void HAL_Sensor_IPMTemperature_SetValue(UINT8 ucValue)
{
	Sensor_IPMTemperature_SetValue(ucValue);
}
