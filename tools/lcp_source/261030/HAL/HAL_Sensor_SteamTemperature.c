/*
 * HAL_Sensor_SteamTemperature.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/Sensor_SteamTemperature.h"


/**
* @fn void HAL_Sensor_SteamTemperature_Init(void)
* Sensor_SteamTemperature 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		Sensor_SumpTemperature 초기화
*/
void HAL_Sensor_SteamTemperature_Init(void)
{
	Sensor_SteamTemperature_Init();
}

#ifndef __SILS__
/**
* @fn UINT8 HAL_Sensor_SteamTemperature_GetTemperature(void)
* * @param	없음
* @return	UINT8				Steam Temperature 값
* @see		Steam Temperature 값 확인
*/
UINT8 HAL_Sensor_SteamTemperature_GetTemperature(void)
{
	return Sensor_SteamTemperature_GetTemperature();
}

/**
* @fn UINT8 HAL_Sensor_SteamTemperature_GetValue(void)
* * @param	없음
* @return	UINT8				Steam Temperature AD 값
* @see		Steam Temperature AD 값 확인
*/
UINT8 HAL_Sensor_SteamTemperature_GetValue(void)
{
	return Sensor_SteamTemperature_GetValue();
}
#endif
