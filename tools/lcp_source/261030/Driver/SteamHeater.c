/*
 * SteamHeater.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#include <math.h>
#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "./Sensor_DCLink.h"
#include "./Timer.h"


#define	STEAM_HEATER_POWERCONSUMPTION_PER_ACVOLTAGE	(0.01909722222222222222222222222222)	// 1100W / (240V * 240V) = 0.01909722222222222222222222222222, Watt = V^2/R


static BOOL mb_IsOn;

/**
* @fn void SteamHeater_Init(void)
* SteamHeater에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SteamHeater 초기화
*/
void SteamHeater_Init(void)
{
	mb_IsOn = FALSE;
}

/**
* @fn void SteamHeater_TurnOn(void)
* SteamHeater에 대한 On 요청
* @param	없음
* @return	없음
* @see		SteamHeater 포트 On, 이전 SteamHeater 포트 상태값 저장.
*/
void SteamHeater_TurnOn(void)
{
	mb_IsOn = TRUE;
}

/**
* @fn void SteamHeater_TurnOff(void)
* SteamHeater에 대한 Off 요청
* @param	없음
* @return	없음
* @see		SteamHeater 포트  off, 이전 SteamHeater 포트 상태값 저장.
*/
void SteamHeater_TurnOff(void)
{
	mb_IsOn = FALSE;
}

/**
* @fn BOOL SteamHeater_IsOn(void)
* SteamHeater에 대한 상태 확인.
* @param	없음
* @return	BOOL				SteamHeater ON or OFF 상태 값
* @see		SteamHeater 상태 확인
*/
BOOL SteamHeater_IsOn(void)
{
	return mb_IsOn;
}

/**
* @fn double SteamHeater_GetEnergyUsageWatt(void)
* SteamHeater 에너지 사용량 측정 함수
* @param	없음
* @return	double	에너지 사용량
* @see
*/
double SteamHeater_GetEnergyUsageWatt(void)
{
	double dEnergyUsageWatt = 0.0;
	double dACVoltage = Sensor_DCLink_GetACVoltage();

	if(mb_IsOn == TRUE)
	{
		dEnergyUsageWatt = STEAM_HEATER_POWERCONSUMPTION_PER_ACVOLTAGE * pow(dACVoltage, 2.0);
	}
	else
	{
		;
	}

	return dEnergyUsageWatt;
}
