/*
 * AutoDispenser.c
 *
 *  Created on: 2025. 10. 30.
 *      Author: hyuntaek.cho
 */

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"
//#include "../Common/CommonConfig.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "./Timer.h"


/* --------------- Define 정의  ---------------  */
#define AUTODISPENSER_CHECKINGSTATE_TIME_SEC		(3)
#define AUTODISPENSER_CHECKINGSTATE_PULSE			(2)


/* --------------- Typedef형 정의  ---------------  */
typedef struct
{
	BOOL bIsOn;							// 자동세제 On/Off 상태
	BOOL bDirectionCCW;					// 자동세제 회전방향 (CCW : 1, CW : 0)
	UINT8 ucCurrentDetergentPulse;		// 자동세제 Current 세제량 Pulse
	UINT8 ucTargetDetergentPulse;		// 자동세제 Target 세제량 Pulse
} T_AutoDispenserDevice;

typedef enum
{
	CHECKINGSTATE_UNDEFINE = 0,
	CHECKINGSTATE_INITIAL,
	CHECKINGSTATE_RUNNING,
	CHECKINGSTATE_COMPLETE,
	CHECKINGSTATE_MAX
} T_E_CheckingState;


/* --------------- 함수 원형 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */
static T_AutoDispenserDevice mstAutoDispenserInfo;
static T_E_CheckingState meAutoDispenser_CheckingState;
static T_E_AutoDispenserStatus meAutoDispenserStatus;


/* --------------- 함수 정의  ---------------  */
/**
* @fn void AutoDispenser_Init(void)
* AutoDispenser 초기화 함수
* @param 	없음
* @return 	없음
* @see
*/
void AutoDispenser_Init(void)
{
	AUTODISPENSER_CCW_PORT = OFF;
	AUTODISPENSER_CW_PORT = OFF;
	mstAutoDispenserInfo.bIsOn = OFF;
	mstAutoDispenserInfo.bDirectionCCW = FALSE;
	mstAutoDispenserInfo.ucCurrentDetergentPulse = 0;
	mstAutoDispenserInfo.ucTargetDetergentPulse = 0;
}

/**
* @fn void AutoDispenser_TurnOn(void)
* AutoDispenser Turn On 함수
* @param 	없음
* @return 	없음
* @see
*/
void AutoDispenser_TurnOn(void)
{
	if(mstAutoDispenserInfo.bIsOn == FALSE)
	{
		mstAutoDispenserInfo.bIsOn = TRUE;
		if(mstAutoDispenserInfo.bDirectionCCW == TRUE)
		{
			AUTODISPENSER_CCW_PORT = SET;
			AUTODISPENSER_CW_PORT = OFF;
		}
		else
		{
			AUTODISPENSER_CCW_PORT = OFF;
			AUTODISPENSER_CW_PORT = SET;
		}
	}
	else
	{
		;
	}
}

/**
* @fn void AutoDispenser_TurnOff(void)
* AutoDispenser_TurnOff Turn Off 함수
* @param 	없음
* @return 	없음
* @see
*/
void AutoDispenser_TurnOff(void)
{
	if(mstAutoDispenserInfo.bIsOn == TRUE)
	{
		mstAutoDispenserInfo.bIsOn = FALSE;
		AUTODISPENSER_CCW_PORT = OFF;
		AUTODISPENSER_CW_PORT = OFF;
	}
	else
	{
		;
	}
}

/**
* @fn BOOL AutoDispenser_IsOn(void)
* 자동세재 상태변수값 Return 함수
* @param	없음
* @return	mb_IsOn		자동세재 상태 값 (1 : On, 0 : Off)
* @see
*/
BOOL AutoDispenser_IsOn(void)
{
	return mstAutoDispenserInfo.bIsOn;
}

/**
* @fn void AutoDispenser_SetDirectionCCW(void)
* 자동세재 회전방향 설정 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	없음
* @see
*/
void AutoDispenser_SetDirectionCCW(void)
{
	mstAutoDispenserInfo.bDirectionCCW = TRUE;
}

/**
* @fn void AutoDispenser_SetDirectionCW(void)
* 자동세재 회전방향 설정 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	없음
* @see
*/
void AutoDispenser_SetDirectionCW(void)
{
	mstAutoDispenserInfo.bDirectionCCW = FALSE;
}

/**
* @fn BOOL AutoDispenser_IsDirectionCCW(void)
* 자동세재 회전방향 Return 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	bDirectionCCW	자동세재 회전방향
* @see
*/
BOOL AutoDispenser_IsDirectionCCW(void)
{
	return mstAutoDispenserInfo.bDirectionCCW;
}

/**
* @fn UINT8 AutoDispenser_GetDetergentPulse(void)
* 자동세재 현재 세재량 Return 함수
* @param	없음
* @return	UINT16				세제량 (Pulse 단위 )
* @see		세제량 값  확인 Pulse 수
*/
UINT8 AutoDispenser_GetDetergentPulse(void)
{
	return mstAutoDispenserInfo.ucCurrentDetergentPulse;
}

/**
* @fn void AutoDispenser_ClearDetergentPulse(void)
* 자동세재 현재 세재량 Clear 함수
* @param	없음
* @return	없음
* @see		이전에 저장하였던 세레량 값 Clear함.
*/
void AutoDispenser_ClearDetergentPulse(void)
{
	mstAutoDispenserInfo.ucCurrentDetergentPulse = 0;
}

/**
* @fn void void AutoDispenser_SetTargetDetergentPulse(UINT8 ucTargetPulse)
* 자동세재 Target 세재량 설정 함수
* @param	ucTargetPulse		Target Pulse
* @return	없음
* @see
*/
void AutoDispenser_SetTargetDetergentPulse(UINT8 ucTargetPulse)
{
	mstAutoDispenserInfo.ucTargetDetergentPulse = ucTargetPulse;
}

/**
* @fn void AutoDispenser_StartCheckingStatus(void)
* 자동 디스펜서 모듈 유무 확인 시작 함수
* @param	없음
* @return	없음
* @see
*/
void AutoDispenser_StartCheckingStatus(void)
{
	meAutoDispenser_CheckingState = CHECKINGSTATE_INITIAL;
}

/**
* @fn BOOL AutoDispenser_IsCompleteCheckingStatus(void)
*  자동 디스펜서 모듈 유무 확인 완료.
* @param	 없음
* @return	BOOL	자동 디스펜서 모듈 유무 확인 완료시 TRUE, 미 완료 : FALSE.
* @see		없음.
*/
BOOL AutoDispenser_IsCompleteCheckingStatus(void)
{
	return (meAutoDispenser_CheckingState == CHECKINGSTATE_COMPLETE);
}

/**
* @fn T_E_AutoDispenserStatus AutoDispenser_GetAutoDispenserStatus(void)
*  자동 디스펜서 모듈 유무.
* @param	 없음
* @return	T_E_AutoDispenserStatus	자동 디스펜서 모듈 유무
* @see		없음.
*/
T_E_AutoDispenserStatus AutoDispenser_GetAutoDispenserStatus(void)
{
	return meAutoDispenserStatus;
}

/**
* @fn void AutoDispenser_RegularControl(void)
* 자동 디스펜서 모듈 유무 확인 함수, Regular Control에서 Main 주기마다 호출
* @param	없음
* @return	없음
* @see
*/
void AutoDispenser_RegularControl(void)
{
//	T_Context* pstContext = CommonConfig_Get_Context();	 // 별도 변수화 해서 판단 값 올려줘야함. 
	static T_Time stTimer_CheckStatus;

	switch(meAutoDispenser_CheckingState)
	{
		case CHECKINGSTATE_INITIAL:
			AutoDispenser_ClearDetergentPulse();
			AutoDispenser_SetDirectionCW();
			Timer_GetTime(&stTimer_CheckStatus);
			meAutoDispenserStatus = AUTODISPENSER_STATUS_UNKNOW;
			meAutoDispenser_CheckingState = CHECKINGSTATE_RUNNING;
		break;

		case CHECKINGSTATE_RUNNING:
			if(Timer_SecCheckPassTime(&stTimer_CheckStatus, AUTODISPENSER_CHECKINGSTATE_TIME_SEC, NONE) == TRUE)
			{
				if(AutoDispenser_GetDetergentPulse() >= AUTODISPENSER_CHECKINGSTATE_PULSE)
				{
					meAutoDispenserStatus = AUTODISPENSER_STATUS_EXISTENCE;
				}
				else
				{
					meAutoDispenserStatus = AUTODISPENSER_STATUS_NONE;
				}
				AutoDispenser_TurnOff();
				meAutoDispenser_CheckingState = CHECKINGSTATE_COMPLETE;
			}
			else
			{
				AutoDispenser_TurnOn();
			}
		break;

		default:
		break;
	}
}

/**
* @fn void AutoDispenser_ISR_External_Pulse(void)
* 외부 Interrupt 함수, 외부에서 신호가 올 때마다 호출되는 함수
* @param	없음
* @return	없음
* @see
*/
void AutoDispenser_ISR_External_Pulse(void)
{
	if(mstAutoDispenserInfo.ucCurrentDetergentPulse < UINT8_MAX_VALUE)
	{
#ifndef __SILS__
		mstAutoDispenserInfo.ucCurrentDetergentPulse++;
#else
		if(mstAutoDispenserInfo.bIsOn == TRUE)
		{
			mstAutoDispenserInfo.ucCurrentDetergentPulse++;
		}
		else
		{
			;
		}
#endif
	}
	else
	{
		;
	}
}
