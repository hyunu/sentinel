/*
 * CommInverter.h
 *
 *  Created on: 2021. 7. 6.
 *      Author: 
 */

#ifndef COMMINVERTER_H_
#define COMMINVERTER_H_

// BlackBox Motor 관련
typedef enum
{
	BLACKBOX_MOTOR_DRAIN_LOCK_COUNT = 0,
	BLACKBOX_MOTOR_WASH_LOCK_COUNT,
	BLACKBOX_MOTOR_ANGLE_ERROR_COUNT,
	BLACKBOX_MOTOR_SPEED_ERROR_COUNT,
	BLACKBOX_MOTOR_HW_CURRENT_LIMIT_COUNT,
	BLACKBOX_MOTOR_SW_CURRENT_LIMIT_COUNT,
	BLACKBOX_MOTOR_FO_COUNT,
	BLACKBOX_MOTOR_DRAIN_OUT_OF_PHASE,
	BLACKBOX_MOTOR_RUN_COUNT,
	SMART_DRAIONOPERATINGFAIL,
	SMART_MOTORPOWERLINEFAIL,
	BLACKBOX_MOTOR_MAX
} T_E_BlackBoxMotorData;

// 통신 주기
void Comm_ISR_Timer_10ms_DecTimer(void);
void Comm_Set_INVSendTimer(void);
UINT8 Comm_Get_INVSendTimer(void);

//통신 Error Check 주기
void Comm_Error_Check_Timer_100ms_IncTimer(void);
void Comm_SetErrorCheckTimer(void);

//Communication for Tx
void Comm_Set_SendINVData(void);
void Comm_Transmit_INVData(UINT8 ucValue);
UINT8 Comm_GetTxDataNum(void);
void Comm_Send_INVData(void);
void Comm_ISR_Sending_INVData(void);

//Communication for Rx
void Comm_ISR_INV_GetReceiveData(void);
void Comm_Receive_INVData(void);

// Motor Fail Flag 통신
BOOL Comm_Get_Smart_DrainOpeartingFlag(void);
BOOL Comm_Get_Smart_MotorPowerLineFlag(void);

//Packet number return
UINT16 Comm_Get_DataID(void);

//Inverter FOTA Mode Request
void Comm_Set_InverterFOTA(void);

void Driver_CommInverter_Set_WashMotorOffDelay(void);

UINT16 Comm_Get_MotorMonitoringData(T_E_BlackBoxMotorData eMotorData);
void Comm_Clear_MotorMonitoringData(void);
void Comm_Clear_WashMotor_LEFlag(void);

#endif
