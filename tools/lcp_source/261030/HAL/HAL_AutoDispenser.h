/*
 * HAL_AutoDispenser.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#ifndef HAL_AUTODISPENSER_H_
#define HAL_AUTODISPENSER_H_

void HAL_AutoDispenser_Init(void);
void HAL_AutoDispenser_TurnOn(void);
void HAL_AutoDispenser_TurnOff(void);
BOOL HAL_AutoDispenser_IsOn(void);
void HAL_AutoDispenser_SetDirectionCCW(void);
void HAL_AutoDispenser_SetDirectionCW(void);
BOOL HAL_AutoDispenser_IsDirectionCCW(void);
UINT8 HAL_AutoDispenser_GetDetergentPulse(void);
void HAL_AutoDispenser_ClearDetergentPulse(void);
void HAL_AutoDispenser_SetTargetDetergentPulse(UINT8 ucTargetPulse);
void HAL_AutoDispenser_StartCheckingStatus(void);
BOOL HAL_AutoDispenser_IsCompleteCheckingStatus(void);
T_E_AutoDispenserStatus HAL_AutoDispenser_GetAutoDispenserStatus(void);
void HAL_AutoDispenser_RegularControl(void);
void HAL_AutoDispenser_ISR_External_Pulse(void);

#endif /* HAL_AUTODISPENSER_H_ */
