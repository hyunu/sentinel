/*
 * HAL_Sensor_HeatDryTemperature.h
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#ifndef HAL_SENSOR_HEATDRYTEMPERATURE_H_
#define HAL_SENSOR_HEATDRYTEMPERATURE_H_

void HAL_Sensor_HeatDryTemperature_Init(void);
UINT8 HAL_Sensor_HeatDryTemperature_GetValue(void);
UINT8 HAL_Sensor_HeatDryTemperature_GetTemperature(void);
UINT8 HAL_Sensor_HeatDryTemperature_GetMaxTemperature(void);

#endif /* HAL_SENSOR_HEATDRYTEMPERATURE_H_ */
