/*
 * Sensor_HeatDryTemperature.h
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#ifndef SENSOR_HEATDRYTEMPERATURE_H_
#define SENSOR_HEATDRYTEMPERATURE_H_

void Sensor_HeatDryTemperature_Init(void);
void Sensor_HeatDryTemperature_SetValue(UINT8 ucValue);
UINT8 Sensor_HeatDryTemperature_GetValue(void);
UINT8 Sensor_HeatDryTemperature_GetTemperature(void);
UINT8 Sensor_HeatDryTemperature_GetMaxTemperature(void);
UINT8 Sensor_HeatDryTemperature_GetAdcLimitValue(UINT16 unCurrentAdc);

#endif /* SENSOR_HEATDRYTEMPERATURE_H_ */
