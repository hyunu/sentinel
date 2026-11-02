/*
 * HAL_TurbiditySensor.h
 *
 *  Created on: 2013. 7. 29.
 *      Author: youngho1.hwang
 */

#ifndef HAL_TURBIDITYSENSOR_H_
#define HAL_TURBIDITYSENSOR_H_

void HAL_TurbiditySensor_Init(void);
void HAL_TurbiditySensor_TurnOn(void);
void HAL_TurbiditySensor_TurnOff(void);
UINT16 HAL_TurbiditySensor_GetNTUValue(void);
void HAL_TurbiditySensor_RequestStartTurbidityValue(void);
BOOL HAL_TurbiditySensor_IsCompleteTurbidityValue(void);
UINT16 HAL_TurbiditySensor_GetTurbidityValue(void);
BOOL HAL_TurbiditySensor_IsFault_Communication(void);
void HAL_TurbiditySensor_RegularControl(void);
void HAL_TurbiditySensor_Isr_Timer_100ms_CheckTimer(void);
void HAL_TurbiditySensor_ISR_Send_Data(void);
void HAL_TurbiditySensor_ISR_Receive_Data(void);
void HAL_TurbiditySensor_ISR_Timer_10ms_CheckUart(void);

#endif /* HAL_TURBIDITYSENSOR_H_ */
