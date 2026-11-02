#include "../Common/Type.h"
#include "../Driver/CommInverter.h"

//통신 주기
void HAL_Comm_ISR_Timer_10ms_DecTimer(void)
{
    Comm_ISR_Timer_10ms_DecTimer();
}

//통신 Error Check
void HAL_Comm_Error_Check_Timer_100ms_DecTimer(void)
{
    Comm_Error_Check_Timer_100ms_IncTimer();
}

void HAL_Comm_ISR_INV_GetReceiveData(void)
{
	Comm_ISR_INV_GetReceiveData();
}

//Communication for Tx
void HAL_Comm_ISR_Sending_INVData(void)
{
	Comm_ISR_Sending_INVData();
}

void HAL_Comm_SendINVData(void)
{
	Comm_Send_INVData();
}

BOOL HAL_Comm_Get_Smart_DrainOpeartingFlag(void)
{
	return Comm_Get_Smart_DrainOpeartingFlag();
}

BOOL HAL_Comm_Get_Smart_MotorPowerLineFlag(void)
{
	return Comm_Get_Smart_MotorPowerLineFlag();
}

UINT16 HAL_Comm_Get_DataID(void)
{
	return Comm_Get_DataID();
}

void HAL_Comm_Set_InverterFOTA(void)
{
	Comm_Set_InverterFOTA();
}
