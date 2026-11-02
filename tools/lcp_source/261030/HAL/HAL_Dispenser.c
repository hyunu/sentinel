/*
 * HAL_Dispenser.c
 *
 *  Created on: 2013. 7. 25.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/Dispenser.h"

/**
* @fn void HAL_Dispenser_Init(void)
* Dispenser에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		Dispenser 드라이버 초기화
*/

void HAL_Dispenser_Init(void)
{
	Dispenser_Init();
}

/**
* @fn void HAL_HAL_Dispenser_TurnOn(void)
* Dispenser 포트에 대한 On 요청
* @param	없음
* @return	없음
* @see		Dispenser 포트 On
*/

void HAL_Dispenser_TurnOn(void)
{
	Dispenser_TurnOn();
}

/**
* @fn void HAL_Dispenser_TurnOff(void)
* Dispenser 포트에 대한 Off 요청
* @param	없음
* @return	없음
* @see		Dispenser 포트  off
*/
void HAL_Dispenser_TurnOff(void)
{
	Dispenser_TurnOff();
}

/**
* @fn BOOL HAL_Dispenser_IsOn(void)
* Dispenser 포트에 대한 상태 확인.
* @param	없음
* @return	BOOL				Dispenser 포트 ON or OFF 상태 값
* @see		Dispenser 포트 상태 확인
*/
BOOL HAL_Dispenser_IsOn(void)
{
	return Dispenser_IsOn();
}
