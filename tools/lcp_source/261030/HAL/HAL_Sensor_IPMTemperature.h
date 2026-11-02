/*
 * HAL_Sensor_IPMTemperature.h
 *
 *  Created on: 2014. 1. 3.
 *      Author: seongju.lim
 */

#ifndef HAL_SENSOR_IPMTEMPERATURE_H_
#define HAL_SENSOR_IPMTEMPERATURE_H_

void HAL_Sensor_IPMTemperature_Init(void);
UINT8 HAL_Sensor_IPMTemperature_GetTemp(void);
UINT8 HAL_Sensor_IPMTemperature_GetMaxTemp(void);
void HAL_Sensor_IPMTemperature_SetValue(UINT8 ucValue);

#endif /* HAL_SENSOR_IPMTEMPERATURE_H_ */
