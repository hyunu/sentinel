/*
 * AutoDispenser.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#ifndef AUTODISPENSER_H_
#define AUTODISPENSER_H_

void AutoDispenser_Init(void);
void AutoDispenser_TurnOn(void);
void AutoDispenser_TurnOff(void);
BOOL AutoDispenser_IsOn(void);
void AutoDispenser_SetDirectionCCW(void);
void AutoDispenser_SetDirectionCW(void);
BOOL AutoDispenser_IsDirectionCCW(void);
UINT8 AutoDispenser_GetDetergentPulse(void);
void AutoDispenser_ClearDetergentPulse(void);
void AutoDispenser_SetTargetDetergentPulse(UINT8 ucTargetPulse);
void AutoDispenser_StartCheckingStatus(void);
BOOL AutoDispenser_IsCompleteCheckingStatus(void);
T_E_AutoDispenserStatus AutoDispenser_GetAutoDispenserStatus(void);
void AutoDispenser_RegularControl(void);
void AutoDispenser_ISR_External_Pulse(void);

#endif /* AUTODISPENSER_H_ */
