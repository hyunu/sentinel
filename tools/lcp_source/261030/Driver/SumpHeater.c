/*
 * SumpHeater_Filter.c
 *
 *  Created on: 2013. 7. 4.
 *      Author: youngho1.hwang
 */

#include <math.h>
#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "./DoorLatch.h"
#include "./Sensor_DCLink.h"


#define	SUMPHEATER_POWERCONSUMPTION_PER_ACVOLTAGE	(0.03402646502835538752362948960302)		// 1800W / (230V * 230V) = 0.03402646502835538752362948960302, Watt = V^2/R


static BOOL mb_IsOn;
static BOOL mb_IsIPMTempControl;


/**
* @fn void SumpHeater_Init(void)
* SumpHeater에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SumpHeater 초기화
*/

void SumpHeater_Init(void)
{
	mb_IsOn = FALSE;
}

/**
* @fn void SumpHeater_TurnOn(void)
* SumpHeater에 대한 On 요청
* @param	없음
* @return	없음
* @see		SumpHeater 포트 On.
*/
void SumpHeater_TurnOn(void)
{
	mb_IsOn = TRUE;
}

/**
* @fn void SumpHeater_TurnOff(void)
* SumpHeater에 대한 Off 요청
* @param	없음
* @return	없음
* @see		SumpHeater 포트  off.
*/
void SumpHeater_TurnOff(void)
{
	mb_IsOn = FALSE;
}

/**
* @fn BOOL SumpHeater_IsOn(void)
* SumpHeater에 대한 상태 확인.
* @param	없음
* @return	BOOL				SumpHeater ON or OFF 상태 값
* @see		SumpHeater 상태 확인
*/
BOOL SumpHeater_IsOn(void)
{
	return mb_IsOn;
}

double SumpHeater_GetEnergyUsageWatt(void)
{
	double dEnergyUsageWatt = 0.0;
	double dACVoltage = Sensor_DCLink_GetACVoltage();

	if((mb_IsOn == TRUE) && (mb_IsIPMTempControl == FALSE))
	{
		dEnergyUsageWatt = SUMPHEATER_POWERCONSUMPTION_PER_ACVOLTAGE * pow(dACVoltage, 2.0);
	}
	else
	{
		;
	}

	return dEnergyUsageWatt;
}

/**
* @fn void SumpHeater_SetIPMTempControl(void)
* IPM 보호 모드 동작  함수
* @param	없음
* @return	없음
* @see
*/
void SumpHeater_SetIPMTempControl(void)
{
	mb_IsIPMTempControl = TRUE;
}

/**
* @fn void SumpHeater_ClearIPMTempControl(void)
* IPM 보호 모드 동작 해제  함수
* @param	없음
* @return	없음
* @see
*/
void SumpHeater_ClearIPMTempControl(void)
{
	mb_IsIPMTempControl = FALSE;
}
