/*
 * HAL_Sensor_SteamTemperature.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#ifndef HAL_SENSOR_STEAMTEMPERATURE_H_
#define HAL_SENSOR_STEAMTEMPERATURE_H_

void HAL_Sensor_SteamTemperature_Init(void);
UINT8 HAL_Sensor_SteamTemperature_GetTemperature(void);
UINT8 HAL_Sensor_SteamTemperature_GetValue(void);

#endif /* HAL_SENSOR_STEAMTEMPERATURE_H_ */
