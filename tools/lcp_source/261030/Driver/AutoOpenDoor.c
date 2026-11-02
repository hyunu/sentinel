/*
 * AutoOpenDoor.c
 *
 *  Created on: 2015. 3. 10
 *      Author: yongtae.kwon
 */


#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "./Timer.h"
#include "./AutoOpenDoor.h"


#define		AODMOTORCHECK_TIME	20		/* AOD Motor 최대 기동 시간(sec) */

static T_E_AODMotorStatus meAODMotorStatus;


/**
* @fn void AutoOpenDoor_Init(void)
* AutoOpenDoor 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void AutoOpenDoor_Init(void)
{
	AOD_OPEN_PORT = OFF;
	AOD_CLOSE_PORT = OFF;
	meAODMotorStatus = AOD_MOTOR_STOP;
}

/**
* @fn void AutoOpenDoor_Open(void)
* AutoOpenDoor Open 함수
* @param	없음
* @return	없음
* @see
*/
void AutoOpenDoor_Open(void)
{
	AOD_OPEN_PORT = ON;
	AOD_CLOSE_PORT = OFF;
	meAODMotorStatus = AOD_MOTOR_OPEN;
}

/**
* @fn void AutoOpenDoor_Close(void)
* AutoOpenDoor Close 함수
* @param	없음
* @return	없음
* @see
*/
void AutoOpenDoor_Close(void)
{
	AOD_OPEN_PORT = OFF;
	AOD_CLOSE_PORT = ON;
	meAODMotorStatus = AOD_MOTOR_CLOSE;
}

/**
* @fn void AutoOpenDoor_TurnOff(void)
* AutoOpenDoor Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void AutoOpenDoor_TurnOff(void)
{
	AOD_OPEN_PORT = OFF;
	AOD_CLOSE_PORT = OFF;
	meAODMotorStatus = AOD_MOTOR_STOP;
}

/**
* @fn T_E_AODMotorStatus AutoOpenDoor_IsMotorStatus(void)
* AutoOpenDoor Motor 상태변수값 Return 함수
* @param	없음
* @return	meAODMotorStatus
* @see
*/
T_E_AODMotorStatus AutoOpenDoor_IsMotorStatus(void)
{
	return meAODMotorStatus;
}
