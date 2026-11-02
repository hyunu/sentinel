/*
 * HeatDryHeater.c
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#include <math.h>
#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "./Sensor_DCLink.h"
#include "./HeatDryFan.h"
#include "./Timer.h"


#define	HEATDRY_HEATER_POWERCONSUMPTION_PER_ACVOLTAGE	(0.00661625708884688090737240075614)	// 350W / (230V * 230V) = 0.00661625708884688090737240075614, Watt = V^2/R
#define	HEATDRY_HEATER_LATENTHEAT_COOLING_TIME_SEC		(60)	// 열풍 Heater 잠열 해소를 위한 쿨링 시간 (sec)


static BOOL mb_IsOn;
static BOOL mb_PrevIsOn;
static BOOL mb_IsOn_History;
static T_Time mstHeatDryHeater_Off;


/**
* @fn void HeatDryHeater_Init(void)
* HeatDryHeater에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SteamHeater 초기화
*/
void HeatDryHeater_Init(void)
{
	mb_IsOn = FALSE;
	mb_PrevIsOn = FALSE;
	mb_IsOn_History = FALSE;
}

/**
* @fn void HeatDryHeater_TurnOn(void)
* HeatDryHeater에 대한 On 요청
* @param	없음
* @return	없음
* @see		HeatDryHeater 포트 On, 이전 HeatDryHeater 포트 상태값 저장.
*/
void HeatDryHeater_TurnOn(void)
{
	if(HeatDryFan_IsOn_HeaterCheck() == TRUE)
	{
		mb_IsOn = TRUE;
		mb_IsOn_History = TRUE;
	}
	else
	{
		mb_IsOn = FALSE;
	}
}

/**
* @fn void HeatDryHeater_TurnOn_TestMode(void)
* HeatDryHeater에 대한 On 요청 (열풍팬 미동작 시에도 On)
* @param	없음
* @return	없음
* @see		HeatDryHeater 포트 On, 이전 HeatDryHeater 포트 상태값 저장.
*/
void HeatDryHeater_TurnOn_TestMode(void)
{
	mb_IsOn = TRUE;
	mb_IsOn_History = TRUE;
}

/**
* @fn void HeatDryHeater_TurnOff(void)
* HeatDryHeater에 대한 Off 요청
* @param	없음
* @return	없음
* @see		HeatDryHeater 포트  off, 이전 HeatDryHeater 포트 상태값 저장.
*/
void HeatDryHeater_TurnOff(void)
{
	mb_IsOn = FALSE;
}

/**
* @fn void HeatDryHeater_TurnOff_LQC(void)
* HeatDryHeater에 대한 Off 요청 (열풍 Fan 미동작)
* @param	없음
* @return	없음
* @see		HeatDryHeater 포트  off.
*/
void HeatDryHeater_TurnOff_LQC(void)
{
	mb_IsOn = FALSE;
	mb_IsOn_History = FALSE;
}

/**
* @fn BOOL HeatDryHeater_IsOn(void)
* HeatDryHeater에 대한 상태 확인.
* @param	없음
* @return	BOOL				HeatDryHeater ON or OFF 상태 값
* @see		HeatDryHeater 상태 확인
*/
BOOL HeatDryHeater_IsOn(void)
{
	return mb_IsOn;
}

/**
* @fn void HeatDryHeater_RegularControl(void)
* HeatDryFan Regular 함수, Regular Control에서 Main 주기마다 호출
* @param	없음
* @return	없음
* @see
*/
void HeatDryHeater_RegularControl(void)
{
	if((mb_PrevIsOn == TRUE) && (mb_IsOn == FALSE))
	{
		Timer_GetTime(&mstHeatDryHeater_Off);
	}
	else
	{
		;
	}

	mb_PrevIsOn = mb_IsOn;
}

/**
* @fn double HeatDryHeater_GetEnergyUsageWatt(void)
* HeatDryHeater 에너지 사용량 측정 함수
* @param	없음
* @return	double	에너지 사용량
* @see
*/
double HeatDryHeater_GetEnergyUsageWatt(void)
{
	double dEnergyUsageWatt = 0.0;
	double dACVoltage = Sensor_DCLink_GetACVoltage();

	if(mb_IsOn == TRUE)
	{
		dEnergyUsageWatt = HEATDRY_HEATER_POWERCONSUMPTION_PER_ACVOLTAGE * pow(dACVoltage, 2.0);
	}
	else
	{
		;
	}

	return dEnergyUsageWatt;
}

/**
* @fn BOOL HeatDryHeater_IsElapsedOff(void)
* HeatDryHeater OFF 후 2분 경과 상태 확인.
* @param	없음
* @return	BOOL				HeatDryHeater OFF 후 2분 경과 상태 값
* @see		HeatDryHeater OFF 후 2분 경과 상태 확인
*/
BOOL HeatDryHeater_IsElapsedOff(void)
{
	BOOL bReturn = FALSE;

	if((mb_IsOn_History == FALSE) || (Timer_SecCheckPassTime(&mstHeatDryHeater_Off, HEATDRY_HEATER_LATENTHEAT_COOLING_TIME_SEC, NONE) == TRUE))
	{
		bReturn = TRUE;
	}
	else
	{
		;
	}

	return bReturn;
}
