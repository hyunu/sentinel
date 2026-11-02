/*
 * HAL_TubLamp.h
 *
 *  Created on: 2015. 3. 10.
 *      Author: yongtae.kwon
 */

#ifndef HAL_TUBLAMP_H_
#define HAL_TUBLAMP_H_

void HAL_TubLamp_Init(void);
void HAL_TubLamp_TurnOn(void);
void HAL_TubLamp_TurnOff(void);
BOOL HAL_TubLamp_IsOn(void);
void HAL_TubLamp_SetBrightness(T_E_TubLampBrightLevel eBrightLevel);
void HAL_TubLamp_Isr_Timer_1ms_DutyControl(void);

#endif /* HAL_TUBLAMP_H_ */
