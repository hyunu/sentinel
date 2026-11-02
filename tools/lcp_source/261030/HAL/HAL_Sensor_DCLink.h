/*
 * HAL_Sensor_DCLink.h
 *
 *  Created on: 2013. 7. 27.
 *      Author: seongju.lim
 */

#ifndef HAL_SENSOR_DCLINK_H_
#define HAL_SENSOR_DCLINK_H_

void HAL_Sensor_DCLink_Init(void);
UINT16 HAL_Sensor_DCLink_GetDCLinkVolt(void);
UINT16 HAL_Sensor_DCLink_GetMaxDCLinkVolt(void);
UINT16 HAL_Sensor_DCLink_GetMinDCLinkVolt(void);
double HAL_Sensor_DCLink_GetACVoltage(void);
void HAL_Sensor_DCLink_RequestACVoltage(void);
BOOL HAL_Sensor_DCLink_IsCompleteACVoltage(void);
void HAL_Sensor_DCLink_RegularControl(void);
void HAL_Sensor_DCLink_Isr_Timer_100ms_CheckTimer(void);
void HAL_Set_DCLink_AD_Value(UINT16 unTemp);

#endif /* HAL_SENSOR_DCLINK_H_ */
