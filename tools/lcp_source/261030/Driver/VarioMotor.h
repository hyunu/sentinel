/*
 * VarioMotor.h
 *
 *  Created on: 2013. 7. 17.
 *      Author: youngho1.hwang
 */

#ifndef VARIOMOTOR_H_
#define VARIOMOTOR_H_

typedef enum
{
	VARIOSW_FLAT = 0,
	VARIOSW_RISINGEDGE,
	VARIOSW_FALLINGEDGE
} T_E_VarioSWEdge;

typedef enum
{
	VARIOMOTOR_REQUEST_NONE = 0,
	VARIOMOTOR_REQUEST_FINDBASEPOINT,
	VARIOMOTOR_REQUEST_MOVENOZZLE
} T_E_VarioMotorRequest;

typedef enum
{
	VARIOMOTOR_STATE_INIT = 0,
	VARIOMOTOR_STATE_WAIT_ON_RISINGEDGE,
	VARIOMOTOR_STATE_WAIT_ON_FALLINGEDGE,
	VARIOMOTOR_STATE_MOVE_TO_BASEPOINT,
	VARIOMOTOR_STATE_COMPLETE_FIND_BASEPOINT,
	VARIOMOTOR_STATE_RETRY_FIND_BASEPOINT,
	VARIOMOTOR_STATE_MOVETARPOSITION,
	VARIOMOTOR_STATE_COMPLETE_MOVE_TARGETPOS,
	VARIOMOTOR_STATE_FINAL_ERROR
} T_E_VarioMotorState;

void VarioMotor_RequestToFindBasePoint(void);	//Vario 기준점 찾기 요청
void VarioMotor_RequestToRotateVarioPosition(T_E_VarioStatus); //Vario 초기화 후, Target 변경 요청
void VarioMotor_RequestToStop(void);	// Vario 모터 정지 요청
void VarioMotor_RequestToResume(void);  // Vario 모터 동작 재개 요청(이전 요청값으로 저장)
void VarioMotor_RequestToSetVarioPosition(T_E_VarioStatus eCurrentVarioPosition);

T_E_VarioMotorState VarioMotor_GetState(void);
T_E_VarioMotorRequest VarioMotor_GetCurRequest(void);
T_E_VarioStatus VarioMotor_GetCurVarioPosition(void);
T_E_VarioStatus VarioMotor_GetTarVarioPosition(void);
BOOL VarioMotor_IsComplete_FindBasePoint(void);
BOOL VarioMotor_IsComplete_MoveTargetPos(void);
BOOL VarioMotor_IsFault_MoveTargetPos(void);

void VarioMotor_RegularControl(void);
void VarioMotor_Isr_Timer_50ms_CheckTimer(void);
void VarioMotor_Isr_Timer_50ms_SensingSignal(void);

void VarioMotor_Init(void);
BOOL VarioMotor_IsOn(void);
void VarioMotor_TurnOn(void);
void VarioMotor_TurnOff(void);

T_E_VarioSWEdge VarioMotor_GetSwitchState(void);
UINT8 VarioMotor_GetVarioSWCheckCount(void);
void VarioMotor_ClearVarioSWCheckCount(void);
void VarioMotor_SetFirstFindBasePointFlag(BOOL bVarioInitFlag);
UINT8 VarioMotor_GetFirstVarioInitTime(void);

#endif /* VARIOMOTOR_H_ */
