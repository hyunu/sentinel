/*
 * HAL_VarioMotor.h
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#ifndef HAL_VARIOMOTOR_H_
#define HAL_VARIOMOTOR_H_

#include "../Driver/VarioMotor.h"

void HAL_VarioMotor_RequestToFindBasePoint(void);	//Vario 기준점 찾기 요청
void HAL_VarioMotor_RequestToRotateVarioPosition(T_E_VarioStatus TargetVarioPosition); //Vario 초기화 후, Target 변경 요청
void HAL_VarioMotor_RequestToStop(void);	// Vario 모터 정지 요청
void HAL_VarioMotor_RequestToResume(void);  // Vario 모터 동작 재개 요청(이전 요청값으로 저장)
void HAL_VarioMotor_RequestToSetVarioPosition(T_E_VarioStatus eCurrentVarioPosition);

T_E_VarioMotorState HAL_VarioMotor_GetState(void);
T_E_VarioMotorRequest HAL_VarioMotor_GetCurRequest(void);
T_E_VarioStatus HAL_VarioMotor_GetCurVarioPosition(void);
T_E_VarioStatus HAL_VarioMotor_GetTarVarioPosition(void);
BOOL HAL_VarioMotor_IsComplete_FindBasePoint(void);
BOOL HAL_VarioMotor_IsComplete_MoveTargetPos(void);
BOOL HAL_VarioMotor_IsFault_MoveTargetPos(void);

void HAL_VarioMotor_RegularControl(void);
void HAL_VarioMotor_Isr_Timer_50ms_CheckTimer(void);
void HAL_VarioMotor_Isr_Timer_50ms_SensingSignal(void);

BOOL HAL_VarioMotor_IsOn(void);
void HAL_VarioMotor_Init(void);

T_E_VarioSWEdge HAL_VarioMotor_GetSwitchState(void);
UINT8 HAL_VarioMotor_GetVarioSWCheckCount(void);
void HAL_VarioMotor_ClearVarioSWCheckCount(void);
void HAL_VarioMotor_SetFirstFindBasePointFlag(BOOL bVarioInitFlag);
UINT8 HAL_VarioMotor_GetFirstVarioInitTime(void);

#endif /* HAL_VARIOMOTOR_H_ */
