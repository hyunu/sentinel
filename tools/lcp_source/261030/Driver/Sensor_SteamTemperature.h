/*
 * Sensor_SteamTemperature.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#ifndef SENSOR_STEAMTEMPERATURE_H_
#define SENSOR_STEAMTEMPERATURE_H_

void Sensor_SteamTemperature_Init(void);
void Sensor_SteamTemperature_SetValue(UINT8 ucValue);
UINT8 Sensor_SteamTemperature_GetValue(void);
UINT8 Sensor_SteamTemperature_GetTemperature(void);
UINT8 Sensor_SteamTemperature_GetAdcLimitValue(UINT16 unCurrentAdc);

#endif /* SENSOR_STEAMTEMPERATURE_H_ */
