/*
 * TubLamp.c
 *
 *  Created on: 2015. 3. 10
 *      Author: yongtae.kwon
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"


#define		TUBLMAP_DEFAULT_DUTY	(0)			// Duty : 0 ~ 10 (10%)	// Display 통신(EEPROM 저장값 수신) 전까지는 OFF 상태로 유지
#define		TUBLMAP_MAX_DUTY		(10)		// Max : 10


static BOOL mb_IsOn;
static T_E_Step meStep;
static UINT8 mucDuty;

/**
* @fn void TubLamp_Init(void)
* TubLamp 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void TubLamp_Init(void)
{
	TUBLAMP_PORT = OFF;
	mb_IsOn = FALSE;
	meStep = STEP_0;
	mucDuty = TUBLMAP_DEFAULT_DUTY;
}

/**
* @fn void TubLamp_TurnOn(void)
* TubLamp Turn On 함수
* @param	없음
* @return	없음
* @see
*/
void TubLamp_TurnOn(void)
{
	meStep = (mb_IsOn == FALSE) ? STEP_1 : meStep;
	mb_IsOn = TRUE;
}

/**
* @fn void TubLamp_TurnOff(void)
* TubLamp Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void TubLamp_TurnOff(void)
{
	meStep = STEP_0;
	mb_IsOn = FALSE;
}

/**
* @fn BOOL TubLamp_IsOn(void)
* TubLamp 상태변수값 Return 함수
* @param	없음
* @return	mb_IsOn		TubLamp 상태 값 (1 : On, 0 : Off)
* @see
*/
BOOL TubLamp_IsOn(void)
{
	return mb_IsOn;
}

/**
* @fn void TubLamp_SetBrightness(T_E_TubLampBrightLevel eTubLampBrightLevel)
* TubLamp 밝기 Duty 설정
* @param	T_E_TubLampBrightLevel		밝기설정값
* @return		없음
* @see		TubLamp 밝기 설정
*/
void TubLamp_SetBrightness(T_E_TubLampBrightLevel eBrightLevel)
{
	switch(eBrightLevel)
	{
		case TUBLAMP_OFF:
			mucDuty = 0;					// Off
		break;

		case TUBLAMP_LOW:
			mucDuty = 2;					// 20% Duty
		break;

		case TUBLAMP_HIGH:
			mucDuty = TUBLMAP_MAX_DUTY;		// 100% Duty
		break;

		default:
		break;
	}
}

/**
* @fn void TubLamp_Isr_Timer_1ms_DutyControl(void)
* 1ms마다 호출되는 함수
* @param	없음
* @return	없음
* @see		1ms 주기마다 실행하는 함수
*/
void TubLamp_Isr_Timer_1ms_DutyControl(void)
{
	static UINT16 unCount;

	switch(meStep)
	{
		/*
		 * Tub Lamp Off시
		 */
		case STEP_0:
			unCount = 0;
			TUBLAMP_PORT = OFF;
		break;

		/*
		 * Tub Lamp On시
		 */
		case STEP_1:
			unCount++;
			if(unCount <= mucDuty)
			{
				TUBLAMP_PORT = ON;
			}
			else
			{
				TUBLAMP_PORT = OFF;
			}

			if(unCount >= TUBLMAP_MAX_DUTY)
			{
				unCount = 0;
			}
			else
			{
				;
			}
		break;

		default:
		break;
	}
}
