/*
 * HAL_Sensor_SumpTemperature.h
 *
 *  Created on: 2013. 7. 26.
 *      Author: seongju.lim
 */

#ifndef HAL_SENSOR_SUMPTEMPERATURE_H_
#define HAL_SENSOR_SUMPTEMPERATURE_H_

void HAL_Sensor_SumpTemperature_Init(void);
UINT8 HAL_Sensor_SumpTemperature_GetSumpTemp(void);
UINT8 HAL_Sensor_SumpTemperature_GetMaxSumpTemp(void);
UINT8 HAL_Sensor_SumpTemperature_GetValue(void);

#endif /* HAL_SENSOR_SUMPTEMPERATURE_H_ */
