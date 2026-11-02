/*
 * HAL_Sensor_SumpTemperature.c
 *
 *  Created on: 2013. 7. 26.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/Sensor_SumpTemperature.h"

/**
* @fn void HAL_Sensor_SumpTemperature_Init(void)
* Sensor_SumpTemperature 에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		Sensor_SumpTemperature 초기화
*/

void HAL_Sensor_SumpTemperature_Init(void)
{
	Sensor_SumpTemperature_Init();
}

#ifndef __SILS__
/**
* @fn UINT8 HAL_Sensor_SumpTemperature_GetSumpTemp(void)
* * @param	없음
* @return	UINT8				Sump Temperature 값
* @see		Sump Temperature 값 확인
*/
UINT8 HAL_Sensor_SumpTemperature_GetSumpTemp(void)
{
	return Sensor_SumpTemperature_GetSumpTemp();
}

/**
* @fn UINT8 HAL_Sensor_SumpTemperature_GetMaxSumpTemp(void)
* * @param	없음
* @return	UINT8				Max Sump Temperature 값
* @see		Max Sump Temperature 값 확인
*/
UINT8 HAL_Sensor_SumpTemperature_GetMaxSumpTemp(void)
{
	return Sensor_SumpTemperature_GetMaxSumpTemp();
}

/**
* @fn UINT8 HAL_Sensor_SumpTemperature_GetValue(void)
* * @param	없음
* @return	UINT8				Sump Temperature AD 값
* @see		Sump Temperature AD 값 확인
*/

UINT8 HAL_Sensor_SumpTemperature_GetValue(void)
{
	return Sensor_SumpTemperature_GetValue();
}
#endif
