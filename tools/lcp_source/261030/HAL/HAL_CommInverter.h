#ifndef HAL_COMMINVERTER_H_
#define HAL_COMMINVERTER_H_

//통신 주기
void HAL_Comm_ISR_Timer_10ms_DecTimer(void);

//통신 Error Check 주기
void HAL_Comm_Error_Check_Timer_100ms_DecTimer(void);

//Communication for Tx
void HAL_Comm_SendINVData(void);
void HAL_Comm_ISR_Sending_INVData(void);

//Communication for Rx
void HAL_Comm_ISR_INV_GetReceiveData(void);

// Motor Fail Flag 통신
BOOL HAL_Comm_Get_Smart_DrainOpeartingFlag(void);
BOOL HAL_Comm_Get_Smart_MotorPowerLineFlag(void);

//Packet number return
UINT16 HAL_Comm_Get_DataID(void);

//Inverter FOTA Mode Request
void HAL_Comm_Set_InverterFOTA(void);

#endif /*  HAL_COMMINVERTER_H_*/
