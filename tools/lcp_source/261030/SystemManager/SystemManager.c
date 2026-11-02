/*
 * SystemManager.c
 *
 *  Created on: 2013. 9. 4.
 *      Author: seongju.lim
 */

/* --------------- Header 정의  ---------------  */
#include <machine.h>
#include "../Driver/Device/RX130.h"
#include "../Common/Type.h"
#include "../Common/CommonConfig.h"
#include "../Driver/Driver.h"
#include "../Driver/WashMotor.h"
#include "../HAL/HAL_AquaValve.h"
#include "../HAL/HAL_AutoDispenser.h"
#include "../HAL/HAL_AutoOpenDoor.h"
#include "../HAL/HAL_CommonSensing.h"
#include "../HAL/HAL_DetergentRefill.h"
#include "../HAL/HAL_Dispenser.h"
#include "../HAL/HAL_DoorLatch.h"
#include "../HAL/HAL_DrainMotor.h"
#include "../HAL/HAL_FlowMeter.h"
#include "../HAL/HAL_HeatDryDoor.h"
#include "../HAL/HAL_HeatDryFan.h"
#include "../HAL/HAL_HeatDryHeater.h"
#include "../HAL/HAL_OptionPin_AD.h"
#include "../HAL/HAL_PowerRelay.h"
#include "../HAL/HAL_RegenValve.h"
#include "../HAL/HAL_RinseRefill.h"
#include "../HAL/HAL_SaltRefill.h"
#include "../HAL/HAL_Sensor_DCLink.h"
#include "../HAL/HAL_Sensor_IPMTemperature.h"
#include "../HAL/HAL_Sensor_SumpTemperature.h"
#include "../HAL/HAL_SteamHeater.h"
#include "../HAL/HAL_SteamValve.h"
#include "../HAL/HAL_SteamWater.h"
#include "../HAL/HAL_SumpHeater.h"
#include "../HAL/HAL_TubLamp.h"
#include "../HAL/HAL_TurbiditySensor.h"
#include "../HAL/HAL_Uart.h"
#include "../HAL/HAL_VarioMotor.h"
#include "../HAL/HAL_WashMotor.h"
#include "../HAL/HAL_WaterJacketValve.h"
#include "OptionPin.h"
#include "RegularControl.h"


/* --------------- Define 정의  ---------------  */


/*--------------- Typedef형 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */
static void _InitialDriver(void);
static void _Set_MainSWInfo(T_Context* pstContext);


/* --------------- 전역 변수 정의  ---------------  */


/* --------------- 함수 정의  ---------------  */
/**
* @fn void Main(void)
* Program Entry Point
* Start Up Code 수행 후 Jump
*
* @param[in]	없음
* @param[out]	없음
* @return	없음
*
* @remarks
*	- 내부 데이터 초기화 및 냉장고의 상태(State)에 따라 전이 시켜주는 최 상위 Loop를 포함한다.
*/
void Main(void)
{
	T_Context* pstContext = CommonConfig_Get_Context();

	/* Micom Initialize */
	InitialMicom_Driver();
	HAL_PowerRelay_TurnOn();
	_InitialDriver();
	HAL_Uart_Initial(); 					/* Uart 초기화 		*/
	setpsw_i();								// All Interrupt Enable

	_Set_MainSWInfo(pstContext);
	OptionPin_SetOption(pstContext);
	UnusedPin_Disable(pstContext);

	while(1)
	{
		Regular_Control();	// Regular Control 수행
	}
}

/**
* @fn void _InitialDriver(void)
* Driver의 각 기능을 사용하기 전 초기화 하는 작업을 한다.
*/
void _InitialDriver(void)
{
	HAL_SumpHeater_Init();
	HAL_DetergentRefill_Init();
	HAL_Dispenser_Init();
	HAL_RinseRefill_Init();
	HAL_SaltRefill_Init();
	HAL_FlowMeter_Init();
	HAL_RegenValve_Init();
	HAL_AquaValve_Init();
	HAL_WaterJacketValve_Init();
	HAL_Sensor_SumpTemperature_Init();
	HAL_Sensor_DCLink_Init();
	HAL_Sensor_IPMTemperature_Init();
	HAL_CommonSensing_Init();
	HAL_DrainMotor_Init();
	HAL_WashMotor_Init();
	HAL_VarioMotor_Init();
	HAL_TurbiditySensor_Init();
	HAL_TubLamp_Init();
	HAL_AutoOpenDoor_Init();
	HAL_HeatDryDoor_Init();
	HAL_HeatDryFan_Init();
	HAL_HeatDryHeater_Init();
	HAL_AutoDispenser_Init();
	HAL_SteamHeater_Init();
	HAL_SteamValve_Init();
	HAL_SteamWater_Init();
}


void _Set_MainSWInfo(T_Context* pstContext)
{
	pstContext->ulMainSWPartNumber = (T_E_LocalInfo)CommonConfig_Get_MainSWPartNumber();
	pstContext->ulMainSWCheckSum = (T_E_LocalInfo)CommonConfig_Get_MainSWCheckSum();
	pstContext->ucMainSWVersion = (T_E_LocalInfo)CommonConfig_Get_MainSWVersion();
}

/* End of File */
