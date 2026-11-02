/*
 * HeatDryFan.h
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#ifndef HEATDRYFAN_H_
#define HEATDRYFAN_H_

void HeatDryFan_Init(void);
void HeatDryFan_TurnOn(void);
void HeatDryFan_TurnOff(void);
BOOL HeatDryFan_IsOn(void);
UINT16 HeatDryFan_GetCurRPM(void);
UINT8 HeatDryFan_GetTarDuty(void);
void HeatDryFan_SetTarDuty(UINT8 ucDuty);
BOOL HeatDryFan_IsLockDetecting(void);
void HeatDryFan_ClearLockDetecting(void);
BOOL HeatDryFan_IsRetryStatusAfterLock(void);
void HeatDryFan_RegularControl(void);
void HeatDryFan_ISR_External_FG(UINT16 unTimerCount);
UINT8 HeatDryFan_Get_Lock_Retry_Count(void);
BOOL HeatDryFan_IsOn_HeaterCheck(void);

#endif /* HEATDRYFAN_H_ */
