/*
 * Sensor_IPMTemperature.h
 *
 *  Created on: 2014. 1. 3.
 *      Author: seongju.lim
 */

#ifndef SENSOR_IPMTEMPERATURE_H_
#define SENSOR_IPMTEMPERATURE_H_

void Sensor_IPMTemperature_SetValue(UINT8 ucValue);
void Sensor_IPMTemperature_Init(void);
UINT8 Sensor_IPMTemperature_GetTemp(void);
UINT8 Sensor_IPMTemperature_GetMaxTemp(void);

#endif /* SENSOR_IPMTEMPERATURE_H_ */
