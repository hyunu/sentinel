/*
 * TubLamp.h
 *
 *  Created on: 2015. 3. 10
 *      Author: yongtae.kwon
 */

#ifndef TUBLAMP_H_
#define TUBLAMP_H_



void TubLamp_Init(void);
void TubLamp_TurnOn(void);
void TubLamp_TurnOff(void);
BOOL TubLamp_IsOn(void);
void TubLamp_SetBrightness(T_E_TubLampBrightLevel eBrightLevel);
void TubLamp_Isr_Timer_1ms_DutyControl(void);

#endif /* TUBLAMP_H_ */
