/*
 * HAL_Sensor_HeatDryTemperature.c
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/Sensor_HeatDryTemperature.h"

/**
* @fn void HAL_Sensor_HeatDryTemperature_Init(void)
* Sensor_HeatDryTemperature 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		Sensor_HeatDryTemperature 초기화
*/
void HAL_Sensor_HeatDryTemperature_Init(void)
{
	Sensor_HeatDryTemperature_Init();
}

#ifndef __SILS__
/**
* @fn UINT8 HAL_Sensor_HeatDryTemperature_GetValue(void)
* * @param	없음
* @return	UINT8				HeatDry Temperature AD 값
* @see		HeatDry Temperature AD 값 확인
*/
UINT8 HAL_Sensor_HeatDryTemperature_GetValue(void)
{
	return Sensor_HeatDryTemperature_GetValue();
}

/**
* @fn UINT8 HAL_Sensor_HeatDryTemperature_GetTemperature(void)
* * @param	없음
* @return	UINT8				HeatDry Temperature 값
* @see		HeatDry Temperature 값 확인
*/
UINT8 HAL_Sensor_HeatDryTemperature_GetTemperature(void)
{
	return Sensor_HeatDryTemperature_GetTemperature();
}

/**
* @fn UINT8 HAL_Sensor_HeatDryTemperature_GetMaxTemperature(void)
* * @param	없음
* @return	UINT8				HeatDry Max Temperature 값
* @see		HeatDry Max Temperature 값 확인
*/
UINT8 HAL_Sensor_HeatDryTemperature_GetMaxTemperature(void)
{
	return Sensor_HeatDryTemperature_GetMaxTemperature();
}

#endif
