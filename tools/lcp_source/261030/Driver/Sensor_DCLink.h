/*
 * Sensor_DCLink.h
 *
 *  Created on: 2013. 7. 12.
 *      Author: seongju.lim
 */

#ifndef SENSOR_DCLINK_H_
#define SENSOR_DCLINK_H_

void Sensor_DCLink_Init(void);
UINT16 Sensor_DCLink_GetDCLinkVolt(void);
UINT16 Sensor_DCLink_GetMaxDCLinkVolt(void);
UINT16 Sensor_DCLink_GetMinDCLinkVolt(void);
double Sensor_DCLink_GetACVoltage(void);
void Sensor_DCLink_RequestACVoltage(void);
BOOL Sensor_DCLink_IsCompleteACVoltage(void);
void Sensor_DCLink_RegularControl(void);
void Sensor_DCLink_Isr_Timer_100ms_CheckTimer(void);
void Set_DCLink_AD_Value(UINT16 unTemp);
#endif /* SENSOR_DCLINK_H_ */
