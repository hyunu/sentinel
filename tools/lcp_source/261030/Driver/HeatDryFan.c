/*
 * HeatDryFan.c
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "./Timer.h"
#include "./HeatDryHeater.h"


/* --------------- Define 정의  ---------------  */
#define HEATDRYFAN_MIN_DUTY					(20)				// 20%
#define HEATDRYFAN_MAX_DUTY					(100)				// 100%
#define HEATDRYFAN_MIN_PWM					(320)				// 최소 Duty : 20%
#define HEATDRYFAN_MAX_PWM					(1600)				// 최대 Duty : 100%
#define HEATDRYFAN_PWMCHANGE				(8)
#define HEATDRYFAN_REGULARCONTROL_TIME_MS	(100)
#define HEATDRYFAN_LOCK_DETECTING_COUNT		(60)
#define HEATDRYFAN_LOCK_STOP_TIME_SEC		(5)
#define HEATDRYFAN_LOCK_RETRY_COUNT			(3)
#define HEATDRYFAN_RESTART_TIME_SEC			(10)				// OFF 후 재시작 Timer


/* --------------- Typedef형 정의  ---------------  */
typedef struct
{
	BOOL bIsOn;							// 모터 On/Off 상태
	UINT16 unCurrentRPM;				// 모터 현재 RPM
	UINT16 unTargetDuty;				// 모터 Target Duty
	BOOL bIsLock;						// 모터 Lock 감지
} T_HeatDryFanDevice;

typedef enum
{
	HEATDRYFANSTATUS_INIT = 0,
	HEATDRYFANSTATUS_RUNNING,
	HEATDRYFANSTATUS_STOP,

	HEATDRYFANSTATUS_MAX
} T_HeatDryFanStatus;

/* --------------- 전역변수 선언 --------------- */
static T_HeatDryFanDevice mstHeatDryFanInfo;
static T_HeatDryFanStatus meHeatDryFanStatus;
static BOOL mbPrevHeatDryFan_IsOn;
static UINT16 munHeatDryFan_LockDetectingCount;			// FG 신호가 없으면 0.1초에 1씩 증가
static BOOL mbHeatDryFan_IsLockDetecting;
static T_Time meHeatDryFan_LockRestart_Timer;
static UINT8 mucHeatDryFan_LockRetryCount;
static UINT16 munHeatDryFan_FG_TimerCount = 0xFFFF;
static T_Time meHeatDryFan_PWM_Timer;
static T_Time meHeatDryFan_Start_Check_Timer;
static UINT16 munHeatDryFan_FG_PulseCount;
static UINT16 munHeatDryFan_FG_PulseCountBackup;
static BOOL mbHeatDryFan_IsOn_For_HeaterCheck;

/* --------------- 함수 원형 선언 --------------- */
static void _HeatDryFan_OutPWM(void);
static void _HeatDryFan_PWMOff(void);


/**
* @fn void static _HeatDryFan_OutPWM(void)
* HeatDryFan PWM 출력 함수
* @param	없음
* @return	없음
* @see
*/
static void _HeatDryFan_OutPWM(void)
{
	MTU4.TGRC = (HEATDRYFAN_MAX_PWM - mstHeatDryFanInfo.unTargetDuty);
    MTU.TSTR.BIT.CST4 = 1U; //Start MTU channel 4 counter
	PORTE.PMR.BIT.B5 = 1;
	mbHeatDryFan_IsOn_For_HeaterCheck = TRUE;
}

/**
* @fn static void _HeatDryFan_PWMOff(void)
* HeatDryFan PWM Off 함수
* @param	없음
* @return	없음
* @see
*/
static void _HeatDryFan_PWMOff(void)
{
	MTU.TSTR.BIT.CST4 = 0U; 	 /* Stop MTU channel 4 counter */
	MTU4.TGRC = HEATDRYFAN_MAX_PWM + 1;
	PORTE.PODR.BIT.B5 = 0;
	PORTE.PMR.BIT.B5 = 0;
	mbHeatDryFan_IsOn_For_HeaterCheck = FALSE;
}

/**
* @fn void HeatDryFan_Init(void)
* Heat Dry Fan에 대한 초기화 요청
* @param	없음
* @return	없음
* @see		FanMotor 초기화
*/

void HeatDryFan_Init(void)
{
	mstHeatDryFanInfo.bIsOn = FALSE;
	mstHeatDryFanInfo.unCurrentRPM = CLEAR;
	mstHeatDryFanInfo.unTargetDuty = HEATDRYFAN_MIN_PWM;
	mstHeatDryFanInfo.bIsLock = FALSE;
	mbPrevHeatDryFan_IsOn = FALSE;
	munHeatDryFan_LockDetectingCount = 0;
	mbHeatDryFan_IsLockDetecting = FALSE;
	mucHeatDryFan_LockRetryCount = 0;
	meHeatDryFanStatus = HEATDRYFANSTATUS_INIT;
	munHeatDryFan_FG_PulseCountBackup = munHeatDryFan_FG_PulseCount;
}

/**
* @fn void HeatDryFan_TurnOn(void)
* Heat Dry Fan에 대한 On 요청
* @param	없음
* @return	없음
* @see		PWM On
*/
void HeatDryFan_TurnOn(void)
{
	mstHeatDryFanInfo.bIsOn = TRUE;
}

/**
* @fn void HeatDryFan_TurnOff(void)
* Heat Dry Fan에 대한 Off 요청
* @param	없음
* @return	없음
* @see		PWM off
*/
void HeatDryFan_TurnOff(void)
{
	mstHeatDryFanInfo.bIsOn = FALSE;
}

/**
* @fn BOOL HeatDryFan_IsOn(void)
* Heat Dry Fan에 대한 상태 확인
* @param	없음
* @return	BOOL			HeatDryFan ON or OFF 상태 값
* @see		HeatDryFan 상태 확인
*/
BOOL HeatDryFan_IsOn(void)
{
	return mstHeatDryFanInfo.bIsOn;
}

/**
* @fn UINT16 HeatDryFan_GetCurRPM(void)
* HeatDryFan 현재 RPM 값 Return 함수
* @param	없음
* @return	unCurrentRPM		HeatDryFan 현재 RPM 값
* @see
*/
UINT16 HeatDryFan_GetCurRPM(void)
{
	return mstHeatDryFanInfo.unCurrentRPM;
}

/**
* @fn UINT8 HeatDryFan_GetTarDuty(void)(void)
* HeatDryFan Target Duty 값 Return 함수
* @param	없음
* @return	unTargetDuty		HeatDryFan Target Duty 값
* @see
*/
UINT8 HeatDryFan_GetTarDuty(void)
{
	return (mstHeatDryFanInfo.unTargetDuty / (HEATDRYFAN_MAX_PWM / 100));
}

/**
* @fn void HeatDryFan_SetTarDuty(UINT8 ucDuty)
* HeatDryFan Target Duty 설정 함수
* @param	ucDuty		Target Duty
* @return	없음
* @see
*/
void HeatDryFan_SetTarDuty(UINT8 ucDuty)
{
	if(ucDuty >= HEATDRYFAN_MAX_DUTY)
	{
		mstHeatDryFanInfo.unTargetDuty = HEATDRYFAN_MAX_PWM;
	}
	else if(ucDuty <= HEATDRYFAN_MIN_DUTY)
	{
		mstHeatDryFanInfo.unTargetDuty = HEATDRYFAN_MIN_PWM;
	}
	else
	{
		mstHeatDryFanInfo.unTargetDuty = (ucDuty * (HEATDRYFAN_MAX_PWM / 100));
	}
}

/**
* @fn BOOL HeatDryFan_IsLockDetecting(void)
* Heat Dry Fan에 대한 Lcok 감지 상태 확인
* @param	없음
* @return	BOOL			Lock 감지 상태 값
* @see		HeatDryFan Lock 감지 상태 확인
*/
BOOL HeatDryFan_IsLockDetecting(void)
{
	return mstHeatDryFanInfo.bIsLock;
}

/**
* @fn BOOL HeatDryFan_ClearLockDetecting(void)
* Heat Dry Fan에 대한 Lcok 감지 상태 초기화
* @param	없음
* @return	없음
* @see		HeatDryFan Lock 감지 상태 초기화
*/
void HeatDryFan_ClearLockDetecting(void)
{
	mucHeatDryFan_LockRetryCount = 0;
	mstHeatDryFanInfo.bIsLock = CLEAR;
}

/**
* @fn BOOL HeatDryFan_IsRetryStatusAfterLock(void)
* Heat Dry Fan에 대한 Lock 감지 후 재기동 상태 확인
* @param	없음
* @return	BOOL			Lock 감지 후 재기동 상태 값
* @see		HeatDryFan Lock 감지 후 재기동 상태 확인
*/
BOOL HeatDryFan_IsRetryStatusAfterLock(void)
{
	return mbHeatDryFan_IsLockDetecting;
}

/**
* @fn void HeatDryFan_RegularControl(void)
* HeatDryFan PWM 제어 함수, Regular Control에서 Main 주기마다 호출
* @param	없음
* @return	없음
* @see
*/
void HeatDryFan_RegularControl(void)
{
	UINT32 ulRPM = 0;

	if((mbPrevHeatDryFan_IsOn == FALSE) && (mstHeatDryFanInfo.bIsOn == TRUE))		// Heat Dry Fan On
	{
		munHeatDryFan_LockDetectingCount = 0;
		mbHeatDryFan_IsLockDetecting = FALSE;
		mucHeatDryFan_LockRetryCount = 0;
	}
	else if((mbPrevHeatDryFan_IsOn == TRUE) && (mstHeatDryFanInfo.bIsOn == FALSE))	// Heat Dry Fan Off
	{
		munHeatDryFan_LockDetectingCount = 0;
		mbHeatDryFan_IsLockDetecting = FALSE;
		mucHeatDryFan_LockRetryCount = 0;
	}
	else if((mbHeatDryFan_IsLockDetecting == TRUE) && (Timer_SecCheckPassTime(&meHeatDryFan_LockRestart_Timer, HEATDRYFAN_LOCK_STOP_TIME_SEC, NONE) == TRUE))
	{
		mbHeatDryFan_IsLockDetecting = FALSE;
		mbPrevHeatDryFan_IsOn = FALSE;
	}
	else
	{
		;
	}

	if(Timer_MsecCheckPassTime(&meHeatDryFan_PWM_Timer, HEATDRYFAN_REGULARCONTROL_TIME_MS, UPDATE) == TRUE)
	{
#ifndef __SILS__
		/* RPM 계산 */
		if(munHeatDryFan_FG_TimerCount == 0)
		{
			mstHeatDryFanInfo.unCurrentRPM = 0xFFFF;
		}
		else if(munHeatDryFan_FG_TimerCount == 0xFFFF)
		{
			mstHeatDryFanInfo.unCurrentRPM = 0;
		}
		else
		{
			ulRPM = 600000000 / ((UINT32)munHeatDryFan_FG_TimerCount * 120);				// RPM = 60 / (1 Count 시간(sec) * 극수) = 60 / (1us * 12)
			mstHeatDryFanInfo.unCurrentRPM = (ulRPM > 0xFFFF) ? 0xFFFF : (UINT16)ulRPM;
		}
#else
		/* SILS 가상 RPM 계산 */
		if(mstHeatDryFanInfo.bIsOn == TRUE)
		{
			if(mstHeatDryFanInfo.unCurrentRPM < (HeatDryFan_GetTarDuty() * 27))
			{
				mstHeatDryFanInfo.unCurrentRPM = mstHeatDryFanInfo.unCurrentRPM + 100;
			}
			else if(mstHeatDryFanInfo.unCurrentRPM > (HeatDryFan_GetTarDuty() * 27))
			{
				mstHeatDryFanInfo.unCurrentRPM = (HeatDryFan_GetTarDuty() * 27) - 100;
			}
			else
			{
				mstHeatDryFanInfo.unCurrentRPM = (HeatDryFan_GetTarDuty() * 27);
			}
		}
		else
		{
			// 부하 OFF 시 SILS는 Driver 단에서 자동으로 CurrRPM 0으로 설정 : 이후 Fan Motor 제어 로직에 따라 로직 제외할 것
			mstHeatDryFanInfo.unCurrentRPM = 0;
		}
#endif

		switch(meHeatDryFanStatus)
		{
			case HEATDRYFANSTATUS_INIT:
				if(Timer_SecCheckPassTime(&meHeatDryFan_Start_Check_Timer, HEATDRYFAN_RESTART_TIME_SEC, NONE) == TRUE)
				{
					meHeatDryFanStatus = HEATDRYFANSTATUS_RUNNING;
				}
				else
				{
					_HeatDryFan_PWMOff();
				}
			break;

			case HEATDRYFANSTATUS_RUNNING:
				if	(	((mstHeatDryFanInfo.bIsOn == TRUE) || (HeatDryHeater_IsElapsedOff() == FALSE)) &&
						(mbHeatDryFan_IsLockDetecting == FALSE)
					)
				{
					_HeatDryFan_OutPWM();		// PWM 출력
#ifndef __SILS__
					/* Lock 체크 */
					if(munHeatDryFan_FG_PulseCountBackup == munHeatDryFan_FG_PulseCount)
					{
						munHeatDryFan_LockDetectingCount = (munHeatDryFan_LockDetectingCount < HEATDRYFAN_LOCK_DETECTING_COUNT) ?	\
															(munHeatDryFan_LockDetectingCount + 1) : munHeatDryFan_LockDetectingCount;
						if(munHeatDryFan_LockDetectingCount >= HEATDRYFAN_LOCK_DETECTING_COUNT)
						{
							munHeatDryFan_LockDetectingCount = 0;
							mbHeatDryFan_IsLockDetecting = TRUE;
							Timer_GetTime(&meHeatDryFan_LockRestart_Timer);

							INC_UINT8_SAFETY(mucHeatDryFan_LockRetryCount);
							mstHeatDryFanInfo.bIsLock = (mucHeatDryFan_LockRetryCount >= HEATDRYFAN_LOCK_RETRY_COUNT) ? TRUE : mstHeatDryFanInfo.bIsLock;
						}
						else
						{
							;	///< Do Nothing
						}
					}
					else
					{
						munHeatDryFan_LockDetectingCount = 0;
						mbHeatDryFan_IsLockDetecting = FALSE;
						mucHeatDryFan_LockRetryCount = 0;
					}
#endif
				}
				else
				{
					_HeatDryFan_PWMOff();
					meHeatDryFanStatus = HEATDRYFANSTATUS_STOP;
				}

				munHeatDryFan_FG_PulseCountBackup = munHeatDryFan_FG_PulseCount;
			break;

			case HEATDRYFANSTATUS_STOP:
				if((mstHeatDryFanInfo.bIsOn == TRUE) && (mbPrevHeatDryFan_IsOn == FALSE))
				{
					meHeatDryFanStatus = HEATDRYFANSTATUS_INIT;
					Timer_GetTime(&meHeatDryFan_Start_Check_Timer);
				}
				else
				{
					;
				}
				_HeatDryFan_PWMOff();
			break;

			default:
			break;
		}
		
		mbPrevHeatDryFan_IsOn = mstHeatDryFanInfo.bIsOn;
	}
	else
	{
		;	///< Do Nothing
	}

}

/**
* @fn void HeatDryFan_ISR_External_FG(UINT16 unTimerCount)
* 외부 Interrupt 함수, 외부에서 신호가 올 때마다 호출되는 함수
* @param	없음
* @return	없음
* @see
*/
void HeatDryFan_ISR_External_FG(UINT16 unTimerCount)
{
	if(unTimerCount != 0)
	{
		munHeatDryFan_FG_TimerCount = unTimerCount;
	}
	else
	{
		;
	}
	munHeatDryFan_FG_PulseCount++;
}

/**
* @fn UINT8 HeatDryFan_Get_Lock_Retry_Count(void)
* Heat Dry Fan에 대한 Lock 감지 횟수 반환 함수
* @param	없음
* @return	UINT8			Lock 감지 횟수 (최대값 3)
*/

UINT8 HeatDryFan_Get_Lock_Retry_Count(void)
{
	return mucHeatDryFan_LockRetryCount;
}

/**
* @fn BOOL HeatDryFan_IsOn_HeaterCheck(void)
* Heat Dry Fan PWM 출력 여부에 대한 IsOn 여부 (히터 동작 체크하기 위함)
* @param	없음
* @return	BOOL			Fan PWM 출력 여부
*/

BOOL HeatDryFan_IsOn_HeaterCheck(void)
{
	return mbHeatDryFan_IsOn_For_HeaterCheck;
}
