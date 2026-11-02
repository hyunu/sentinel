/*
 * RegularControl.c
 *
 *  Created on: 2013. 11. 21.
 *      Author: seongju.lim
 */

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"
#include "../Common/CommonConfig.h"
#include "../Driver/Driver.h"
#include "../Driver/Timer.h"
#include "../HAL/HAL_AutoDispenser.h"
#include "../HAL/HAL_CommonSensing.h"
#include "../HAL/HAL_DrainMotor.h"
#include "../HAL/HAL_FlowMeter.h"
#include "../HAL/HAL_HeatDryFan.h"
#include "../HAL/HAL_HeatDryHeater.h"
#include "../HAL/HAL_Sensor_DCLink.h"
#include "../HAL/HAL_TurbiditySensor.h"
#include "../HAL/HAL_VarioMotor.h"
#include "../HAL/HAL_TubLamp.h"
#include "../HAL/HAL_WashMotor.h"
#include "../HAL/HAL_CommInverter.h"
#include "../HAL/HAL_HeatDryDoor.h"
#include "../Library/Lib_EnergyMonitoring.h"
#include "../AppFramework/CommOSP.h"


/* --------------- Define 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */


/* --------------- 전역 상수 정의  ---------------  */


/* --------------- 함수 정의  ---------------  */
/**
* @fn void Regular_Control(void)
* Regular Control 처리
*
* @param	없음
* @return	없음
* @see		없음
* @remarks
*/
void Regular_Control(void)
{
	T_Context* pstContext = CommonConfig_Get_Context();

#ifdef __SILS__
	SILS_main_env_update();
#endif

	WatchDogClear_Driver();
	HAL_CommonSensing_RegularControl();
	HAL_FlowMeter_RegularControl();
	HAL_TurbiditySensor_RegularControl();
	HAL_VarioMotor_RegularControl();
	HAL_HeatDryFan_RegularControl();
	HAL_HeatDryHeater_RegularControl();
	HAL_Sensor_DCLink_RegularControl();
	HAL_WashMotor_RegularControl();
	HAL_DrainMotor_RegularControl();
	HAL_AutoDispenser_RegularControl();

	Lib_EnergyMonitoring_RegularControl();

	CommOSP_RegularControl(pstContext);		// Communication with OSP
	HAL_Comm_SendINVData();					// Communication with Inverter
}

