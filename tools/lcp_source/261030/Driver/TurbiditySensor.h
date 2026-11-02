/*
 * TurbiditySensor.h
 *
 *  Created on: 2013. 7. 11.
 *      Author: youngho1.hwang
 */

#ifndef TURBIDITYSENSOR_H_
#define	TURBIDITYSENSOR_H_

void TurbiditySensor_Init (void);
void TurbiditySensor_TurnOn(void);
void TurbiditySensor_TurnOff(void);
UINT16 TurbiditySensor_GetNTUValue(void);
void TurbiditySensor_RequestStartTurbidityValue(void);
BOOL TurbiditySensor_IsCompleteTurbidityValue(void);
UINT16 TurbiditySensor_GetTurbidityValue(void);
BOOL TurbiditySensor_IsFault_Communication(void);
void TurbiditySensor_RegularControl (void);
void TurbiditySensor_Isr_Timer_100ms_CheckTimer(void);
void TurbiditySensor_ISR_Send_Data(void);
void TurbiditySensor_ISR_Receive_Data(void);
void TurbiditySensor_ISR_Timer_10ms_CheckUart(void);

#endif /* TURBIDITYSENSOR_H_ */
