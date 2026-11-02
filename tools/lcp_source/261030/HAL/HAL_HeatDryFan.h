/*
 * HAL_HeatDryFan.h
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#ifndef HAL_HEATDRYFAN_H_
#define HAL_HEATDRYFAN_H_

void HAL_HeatDryFan_Init(void);
void HAL_HeatDryFan_TurnOn(void);
void HAL_HeatDryFan_TurnOff(void);
BOOL HAL_HeatDryFan_IsOn(void);
UINT16 HAL_HeatDryFan_GetCurRPM(void);
UINT8 HAL_HeatDryFan_GetTarDuty(void);
void HAL_HeatDryFan_SetTarDuty(UINT8 ucDuty);
BOOL HAL_HeatDryFan_IsLockDetecting(void);
void HAL_HeatDryFan_ClearLockDetecting(void);
BOOL HAL_HeatDryFan_IsRetryStatusAfterLock(void);
void HAL_HeatDryFan_RegularControl(void);
void HAL_HeatDryFan_ISR_External_FG(UINT16 unTimerCount);
UINT8 HAL_HeatDryFan_Get_Lock_Retry_Count(void);

#endif /* HAL_HEATDRYFAN_H_ */
