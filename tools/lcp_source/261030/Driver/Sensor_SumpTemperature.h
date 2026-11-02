/*
 * Sensor_SumpTemperature.h
 *
 *  Created on: 2013. 7. 12.
 *      Author: seongju.lim
 */

#ifndef SENSOR_SUMPTEMPERATURE_H_
#define SENSOR_SUMPTEMPERATURE_H_

UINT8 Sensor_SumpTemperature_GetValue(void);
void Sensor_SumpTemperature_SetValue(UINT8 ucValue);
void Sensor_SumpTemperature_Init(void);
UINT8 Sensor_SumpTemperature_GetSumpTemp(void);
UINT8 Sensor_SumpTemperature_GetMaxSumpTemp(void);
UINT8 Sensor_SumpTemperature_GetAdcLimitValue(UINT16 unCurrentAdc);

#endif /* SENSOR_SUMPTEMPERATURE_H_ */
