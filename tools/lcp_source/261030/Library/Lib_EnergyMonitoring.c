/*
 * Lib_EnergyMonitoring.c
 *
 *  Created on: 2021. 10. 11.
 *      Author: hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/Timer.h"
#include "../Driver/Flowmeter.h"
#include "../Driver/HeatDryHeater.h"
#include "../Driver/PowerRelay.h"
#include "../Driver/SteamHeater.h"
#include "../Driver/SumpHeater.h"
#include "../Driver/WashMotor.h"


/* --------------- Define 정의  ---------------  */
#define ENERGYMONITORING_REGULAR_TIME_SEC			(1)


/* --------------- Typedef형 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */
static BOOL mbEnergyMonitoringOn;
static double mdEnergyUsageWatt;
static T_Time mstTimer_EnergyMonitoring;


void Lib_EnergyMonitoring_Start(void)
{
	mdEnergyUsageWatt = 0.0;
	FlowMeter_ClearTotalWaterSupplyPulse();
	Timer_GetTime(&mstTimer_EnergyMonitoring);
	mbEnergyMonitoringOn = TRUE;
}

void Lib_EnergyMonitoring_Stop(void)
{
	mbEnergyMonitoringOn = FALSE;
}

BOOL Lib_EnergyMonitoring_IsOn(void)
{
	return mbEnergyMonitoringOn;
}

double Lib_EnergyMonitoring_GetEnergyUsageWatt(void)
{
	return mdEnergyUsageWatt;
}

UINT16 Lib_EnergyMonitoring_GetEnergyUsageWattHour(void)
{
	return (UINT16)(mdEnergyUsageWatt / 3600);		// 1시간
}

/**
* @fn void Lib_EnergyMonitoring_RegularControl(void)
* 에너지모니터링 측정 함수, Regular Control에서 Main 주기마다 호출
* @param	없음
* @return	없음
* @see
*/
void Lib_EnergyMonitoring_RegularControl(void)
{
	if	(	(mbEnergyMonitoringOn == TRUE) &&
			(Timer_SecCheckPassTime(&mstTimer_EnergyMonitoring, ENERGYMONITORING_REGULAR_TIME_SEC, UPDATE) == TRUE)
		)
	{
		mdEnergyUsageWatt += PowerRelay_GetEnergyUsageWatt() + SumpHeater_GetEnergyUsageWatt() + WashMotor_GetEnergyUsageWatt() + HeatDryHeater_GetEnergyUsageWatt() + SteamHeater_GetEnergyUsageWatt();
	}
	else
	{
		;		///< Do Nothing
	}
}
