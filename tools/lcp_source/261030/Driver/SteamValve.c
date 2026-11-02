/*
 * SteamValve.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"

#define STEAMVALVE_500MS_TIME_COUNT		1000
#define STEAMVALVE_ON_COUNT				5				// 500ms 경과 이후, 500us On Count

static BOOL mb_IsOn;
static T_E_Step meStep;

/**
* @fn void SteamValve_Init(void)
* SteamValve 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void SteamValve_Init(void)
{
	STEAMVALVE_PORT = OFF;
	mb_IsOn = FALSE;
	meStep = STEP_0;
}

/**
* @fn void SteamValve_TurnOn(void)
* SteamValve Turn On 함수
* @param	없음
* @return	없음
* @see
*/
void SteamValve_TurnOn(void)
{
	meStep = (mb_IsOn == FALSE) ? STEP_1 : meStep;
	mb_IsOn = TRUE;
}

/**
* @fn void SteamValve_TurnOff(void)
* SteamValve Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void SteamValve_TurnOff(void)
{
	meStep = STEP_0;
	mb_IsOn = FALSE;
	STEAMVALVE_PORT = OFF;			// meStep과 Port 출력 순서 주의 (순서 반대인 경우, 500us 인터럽트 발생시 Port 출력 Off가 안 될 수 있음)
}

/**
* @fn BOOL SteamValve_IsOn(void)
* SteamValve 상태변수값 Return 함수
* @param	없음
* @return	mb_IsOn		SteamValve 상태 값 (1 : On, 0 : Off)
* @see
*/
BOOL SteamValve_IsOn(void)
{
	return mb_IsOn;
}

/**
* @fn void SteamValve_Isr_Timer_500us_DutyControl(void)
* 500us마다 호출되는 함수
* @param	없음
* @return	없음
* @see		500us 주기마다 실행하는 함수
* 		Valve On시 초기 0.5초는 Full Duty, 이후는 1KHz Half Duty(500us Off-500us On) .
*/
void SteamValve_Isr_Timer_500us_DutyControl(void)
{
	static UINT16 unCount;

	switch(meStep)
	{
		/*
		 * Valve Off시
		 */
		case STEP_0:
			unCount = 0;
		break;

		/*
		 * Valve On이후 초기 500ms 동작 주간
		 * Full Duty On
		 */
		case STEP_1:
			unCount++;
			if(unCount >= STEAMVALVE_500MS_TIME_COUNT)
			{
				STEAMVALVE_PORT = OFF;
				unCount = 0;
				meStep = STEP_2;
			}
			else
			{
				STEAMVALVE_PORT = ON;
			}
		break;

		/*
		 * Valve On 이후 500ms 경과 이후 동작 구간
		 * 1:5 Duty(83.3%, 500us Off-2500us On)
		 */
		case STEP_2:
			unCount++;
			if(unCount >= STEAMVALVE_ON_COUNT)
			{
				unCount = 0;
				meStep = STEP_3;
			}
			else
			{
				;
			}
			STEAMVALVE_PORT = ON;
		break;

		case STEP_3:
			STEAMVALVE_PORT = OFF;
			unCount = 0;
			meStep = STEP_2;
		break;

		default:
		break;

	}
}
