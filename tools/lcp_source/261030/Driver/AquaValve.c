/*
 * AquaValve.c
 *
 *  Created on: 2013. 7. 4
 *      Author: seongju.lim
 */


#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

static BOOL mb_IsOn;

/**
* @fn void AquaValve_Init(void)
* AquaValve 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void AquaValve_Init(void)
{
	AQUAVALVE_PORT = OFF;
	mb_IsOn = FALSE;
}

/**
* @fn void AquaValve_TurnOn(void)
* AquaValve Turn On 함수
* @param	없음
* @return	없음
* @see
*/
void AquaValve_TurnOn(void)
{
	AQUAVALVE_PORT = ON;
	mb_IsOn = TRUE;
}

/**
* @fn void AquaValve_TurnOff(void)
* AquaValve Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void AquaValve_TurnOff(void)
{
	AQUAVALVE_PORT = OFF;
	mb_IsOn = FALSE;
}

/**
* @fn BOOL AquaValve_IsOn(void)
* AquaValve 상태변수값 Return 함수
* @param	없음
* @return	mb_IsOn		AquaValve 상태 값 (1 : On, 0 : Off)
* @see
*/
BOOL AquaValve_IsOn(void)
{
	return mb_IsOn;
}
