/*
 * Dispenser.c
 *
 *  Created on: 2013. 7. 24.
 *      Author: youngho1.hwang
 */
#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

static BOOL mb_IsOn;

/**
* @fn void Dispenser_Init(void)
* Dispenser에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		Dispenser 드라이버 초기화
*/
void Dispenser_Init(void)
{
	DISPENSER_PORT = OFF;
	mb_IsOn = FALSE;
}

/**
* @fn void Dispenser_TurnOn(void)
* Dispenser 포트에 대한 On 요청
* @param	없음
* @return	없음
* @see		Dispenser 포트 On
*/
void Dispenser_TurnOn(void)
{
	DISPENSER_PORT = ON;
	mb_IsOn = TRUE;
}

/**
* @fn void Dispenser_TurnOff(void)
* Dispenser 포트에 대한 Off 요청
* @param	없음
* @return	없음
* @see		Dispenser 포트 Off
*/
void Dispenser_TurnOff(void)
{
	DISPENSER_PORT = OFF;
	mb_IsOn = FALSE;
}

/**
* @fn BOOL Dispenser_IsOn(void)
* Dispenser 포트에 대한 상태 확인.
* @param	없음
* @return	BOOL				Dispenser 포트 ON or OFF 상태 값
* @see		Dispenser 포트 상태 확인
*/
BOOL Dispenser_IsOn(void)
{
	return mb_IsOn;
}
