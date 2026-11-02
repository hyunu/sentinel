/*
 * HAL_SteamHeater.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/SteamHeater.h"


/**
* @fn void HAL_SteamHeater_Init(void)
* SteamHeater에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		SteamHeater 초기화
*/
void HAL_SteamHeater_Init(void)
{
	SteamHeater_Init();
}

/**
* @fn void HAL_SteamHeater_TurnOn(void)
* SteamHeater에 대한 On 요청
* @param	없음
* @return	없음
* @see		SteamHeater 포트 On.
*/
void HAL_SteamHeater_TurnOn(void)
{
	SteamHeater_TurnOn();
}

/**
* @fn void HAL_SteamHeater_TurnOff(void)
* SteamHeater에 대한 Off 요청
* @param	없음
* @return	없음
* @see		SteamHeater 포트  off.
*/
void HAL_SteamHeater_TurnOff(void)
{
	SteamHeater_TurnOff();
}

/**
* @fn BOOL HAL_SteamHeater_IsOn(void)
* SteamHeater에 대한 상태 확인.
* @param	없음
* @return	BOOL				SteamHeater ON or OFF 상태 값
* @see		SteamHeater 상태 확인
*/
BOOL HAL_SteamHeater_IsOn(void)
{
	return SteamHeater_IsOn();
}
