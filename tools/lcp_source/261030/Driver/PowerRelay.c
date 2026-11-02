/*
 * PowerRelay.c
 *
 *  Created on: 2013. 7. 8.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

#define PCB_AVERAGE_POWERCONSUMPTION_WATT		(5.55)

static BOOL mb_IsOn;

/**
* @fn void PowerRelay_TurnOn(void)
* PowerRelay에 대한 On 요청
* @param	없음
* @return	없음
* @see		PowerRelay 포트 On
*/
void PowerRelay_TurnOn(void)
{
	POWERRELAY_PORT = ON;
	mb_IsOn = TRUE;
}

/**
* @fn void PowerRelay_TurnOff(void)
* PowerRelay에 대한 Off 요청
* @param	없음
* @return	없음
* @see		PowerRelay 포트  off
*/
void PowerRelay_TurnOff(void)
{
	POWERRELAY_PORT = OFF;
	mb_IsOn = FALSE;
}

/**
* @fn BOOL PowerRelay_IsOn(void)
* PowerRelay에 대한 상태 확인.
* @param	없음
* @return	BOOL				PowerRelay ON or OFF 상태 값
* @see		PowerRelay 상태 확인
*/
BOOL PowerRelay_IsOn(void)
{
	return mb_IsOn;
}

double PowerRelay_GetEnergyUsageWatt(void)
{
	double dEnergyUsageWatt = (mb_IsOn == FALSE) ? 0.0 : PCB_AVERAGE_POWERCONSUMPTION_WATT;

	return dEnergyUsageWatt;
}
