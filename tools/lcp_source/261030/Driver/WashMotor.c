/*
 * WashMotor.c
 *
 *  Created on: 2013. 7. 15.
 *      Author: seongju.lim
 */

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"
#include "./Timer.h"
#include "WashMotor.h"


/* --------------- Define 정의  ---------------  */
#define MEASUREMENT_CURRENT_COUNT_MAX		(10)


/* --------------- Typedef형 정의  ---------------  */
typedef struct
{
	BOOL bIsOn;							// 세척모터 On/Off 상태
	BOOL bLEFlag;						// 세척 모터 LE Flag
	BOOL bIntermitFlag;					// 간헐세척 Flag
	UINT16 unTargetRPM;					// 세척모터 Target RPM
	UINT16 unCurrentRPM;				// 세척모터 현재 RPM
	UINT16 unRequestRPM;				// 세척모터 속도제어기 Request RPM
	UINT16 unMotorCurrent;				// 세척모터 전류값
	UINT16 unMotorAerageCurrent;		// 세척모터 평균 전류값
	UINT16 unMotorWatt;					// 세척모터 Watt
} T_WashMotorDevice;


/* --------------- 함수 원형 정의  ---------------  */
static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize);


/* --------------- 전역 변수 정의  ---------------  */
static T_WashMotorDevice mstWashMotorInfo;


/* --------------- 함수 정의  ---------------  */
/**
* @fn static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize)
* 전류 데이터의 소팅 함수.
*
* @param	pulSortingSource		소팅할 배열 주소
* @param	unSize					배열 크기
* @return	UINT32*					소팅후 배열 주소
*/
static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize)
{
	UINT16 uni = 0, unj = 0;
	UINT32 ulTemp = 0;

	for(uni = 0; uni < unSize; uni++)
	{
		for(unj = uni + 1; unj < unSize; unj++)
		{
			if(pulSortingSource[uni] > pulSortingSource[unj])
			{
				ulTemp = pulSortingSource[uni];
				pulSortingSource[uni] = pulSortingSource[unj];
				pulSortingSource[unj] = ulTemp;
			}
			else
			{
				;	///< Do nothing
			}
		}
	}

	return (pulSortingSource);
}

/**
* @fn void WashMotor_SetTarRPM(UINT16 unRPM)
* WashMotor Target RPM 설정 함수
* @param	unRPM		Target RPM
* @return	없음
* @see
*/
void WashMotor_SetTarRPM(UINT16 unRPM)
{
	UINT16 unTargetRPM = unRPM;

	if(unTargetRPM < WASHMOTOR_RPM_MIN)		//최소 RPM 설정.
	{
		unTargetRPM = WASHMOTOR_RPM_MIN;
	}
	else if(unTargetRPM > WASHMOTOR_RPM_MAX)
	{
		unTargetRPM = WASHMOTOR_RPM_MAX;
	}
	else
	{
		;	/// do nothing
	}

	mstWashMotorInfo.unTargetRPM = unTargetRPM;
}

/**
* @fn UINT16 WashMotor_GetTarRPM(void)
* WashMotor Target RPM 반환 함수
* @param	없음
* @return	mstWashMotorInfo.unTargetRPM		Target RPM
* @see
*/
UINT16 WashMotor_GetTarRPM(void)
{
	return mstWashMotorInfo.unTargetRPM;
}

/**
* @fn void WashMotor_TurnOn(void)
* WashMotor Turn On 함수
* @param	없음
* @return	없음
* @see
*/
void WashMotor_TurnOn(void)
{
	mstWashMotorInfo.bIsOn = TRUE;
}

/**
* @fn void WashMotor_TurnOff(void)
* WashMotor Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void WashMotor_TurnOff(void)
{
	mstWashMotorInfo.bIsOn = FALSE;
}

/**
* @fn BOOL WashMotor_IsOn(void)
* WashMotor 상태 Return 함수
* @param	없음
* @return	mstWashMotorInfo.bIsOn	상태값 (1 : On, 0 : Off)
* @see
*/
BOOL WashMotor_IsOn(void)
{
	return mstWashMotorInfo.bIsOn;
}

/**
* @fn void WashMotor_SetIntermitWashFlag(void)
* WashMotor Intermit Wash 설정 함수
* @param	없음
* @return	없음
* @see
*/
void WashMotor_SetIntermitWashFlag(void)
{
	mstWashMotorInfo.bIntermitFlag = TRUE;
}

/**
* @fn void WashMotor_SetNormalWashFlag(void)
* WashMotor Normal Wash 설정 함수
* @param	없음
* @return	없음
* @see
*/
void WashMotor_SetNormalWashFlag(void)
{
	mstWashMotorInfo.bIntermitFlag = FALSE;
}

/**
* @fn BOOL WashMotor_IsIntermitFlagSet(void)
* WashMotor 간헐세척 Flag 값 Return 함수
* @param	없음
* @return	bIntermitFlag	간헐세척 설정여부 (1 : 설정, 0 : 미 설정)
* @see
*/
BOOL WashMotor_IsIntermitFlagSet(void)
{
	return mstWashMotorInfo.bIntermitFlag;
}

/**
* @fn void WashMotor_Init(void)
* WashMotor 변수 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void WashMotor_Init(void)
{
	mstWashMotorInfo.bIsOn = FALSE;
	mstWashMotorInfo.bLEFlag = FALSE;
	mstWashMotorInfo.bIntermitFlag = FALSE;
	mstWashMotorInfo.unTargetRPM = WASHMOTOR_RPM_MIN;
	mstWashMotorInfo.unCurrentRPM = 0;
	mstWashMotorInfo.unRequestRPM = 0;
	mstWashMotorInfo.unMotorCurrent = 0;
	mstWashMotorInfo.unMotorAerageCurrent = 0;
	mstWashMotorInfo.unMotorWatt = 0;
}

/**
* @fn void WashMotor_SetLEFlag(void)
* WashMotor LE Flag Set 함수
* @param	없음
* @return	없음
* @see
*/
void WashMotor_SetLEFlag(void)
{
	mstWashMotorInfo.bLEFlag = SET;
}

/**
* @fn void WashMotor_ClearLEFlag(void)
* WashMotor LE Flag 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void WashMotor_ClearLEFlag(void)
{
	mstWashMotorInfo.bLEFlag = CLEAR;
}

/**
* @fn BOOL WashMotor_IsLEFlagSet(void)
* WashMotor LE Flag 값 Return 함수
* @param	없음
* @return	mbLEFlag	LE 발생 여부 (1 : 발생, 0 : 미 발생)
* @see
*/
BOOL WashMotor_IsLEFlagSet(void)
{
	return mstWashMotorInfo.bLEFlag;
}

/**
* @fn void WashMotor_SetCurRPM(UINT16 unWashMotorRPM)
* WashMotor 현재 RPM 설정 함수
* @param	현재 RPM
* @return	없음
* @see
*/
void WashMotor_SetCurRPM(UINT16 unWashMotorRPM)
{
	mstWashMotorInfo.unCurrentRPM = unWashMotorRPM;
}

/**
* @fn UINT16 WashMotor_GetCurRPM(void)
* WashMotor 현재 RPM Return 함수
* @param	없음
* @return	mstWashMotorInfo.unCurrentRPM		현재 RPM
* @see
*/
UINT16 WashMotor_GetCurRPM(void)
{
	return mstWashMotorInfo.unCurrentRPM;
}

/**
* @fn UINT16 WashMotor_GetRequestRPM(void)
* WashMotor Request RPM 값 Return 함수
* @param	없음
* @return	unRequestRPM		WashMotor Request RPM 값
* @see
*/
UINT16 WashMotor_GetRequestRPM(void)
{
	return mstWashMotorInfo.unRequestRPM;
}

/**
* @fn void WashMotor_SetRequestRPM(UINT16 unRPM)
* WashMotor Request RPM 설정 함수
* @param	unRPM		Request RPM
* @return	없음
* @see
*/
void WashMotor_SetRequestRPM(UINT16 unRPM)
{
	mstWashMotorInfo.unRequestRPM = unRPM;
}

/**
* @fn UINT16 WashMotor_GetMotorCurrent(void)
* WashMotor Current 값 Return 함수
* @param	없음
* @return	unMotorCurrent		WashMotor Current 값
* @see
*/
UINT16 WashMotor_GetMotorCurrent(void)
{
	return mstWashMotorInfo.unMotorCurrent;
}

/**
* @fn void WashMotor_SetMotorCurrent(UINT16 unCurrent)
* WashMotor Motor Current 설정 함수
* @param	unCurrent		Motor Current
* @return	없음
* @see
*/
void WashMotor_SetMotorCurrent(UINT16 unCurrent)
{
	mstWashMotorInfo.unMotorCurrent = unCurrent;
}

/**
* @fn UINT16 WashMotor_GetMotorCurrent(void)
* WashMotor Motor Watt 값 Return 함수
* @param	없음
* @return	unMotorWatt		WashMotor Watt 값
* @see
*/
UINT16 WashMotor_GetMotorWatt(void)
{
	return mstWashMotorInfo.unMotorWatt;
}

/**
* @fn void WashMotor_SetMotorWatt(UINT16 unWatt)
* WashMotor Motor Watt 설정 함수
* @param	unWatt		Motor Watt
* @return	없음
* @see
*/
void WashMotor_SetMotorWatt(UINT16 unWatt)
{
	mstWashMotorInfo.unMotorWatt = unWatt;
}

/**
* @fn double WashMotor_GetEnergyUsageWatt(void)
* WashMotor Motor 현재 에너지사용량 Return 함수
* @param	없음
* @return	dEnergyUsageWatt	WashMotor 현재 에너지사용량
* @see
*/
double WashMotor_GetEnergyUsageWatt(void)
{
	double dEnergyUsageWatt = (mstWashMotorInfo.bIsOn == FALSE) ? 0.0 : (double)mstWashMotorInfo.unMotorWatt;

	return dEnergyUsageWatt;
}

/**
* @fn UINT16 WashMotor_GetMotorCurrent(void)
* WashMotor Motor 평균 전류값 Return 함수
* @param	없음
* @return	unMotorAerageCurrent		WashMotor 평균 전류값
* @see
*/
UINT16 WashMotor_GetMotorAverageCurrent(void)
{
	return mstWashMotorInfo.unMotorAerageCurrent;
}

/**
* @fn void WashMotor_RegularControl(void)
* WashMotor 평균 전류값 계산 함수
* @param	없음
* @return	없음
* @see
*/
void WashMotor_RegularControl(void)
{
	static UINT8 ucCount;
	static UINT32 aulCurrentValue[10] = {0, };
	static UINT32 ulAverageCurrent;
	static T_Time stTimerCurrentDataTime;

	if(mstWashMotorInfo.bIsOn == TRUE)
	{
		if(	(mstWashMotorInfo.unRequestRPM >= WASHMOTOR_RPM_MIN) && (mstWashMotorInfo.unCurrentRPM >= WASHMOTOR_SSLS_MODE_CHANGE_RPM) )
		{
			if(Timer_MsecCheckPassTime(&stTimerCurrentDataTime, 100, UPDATE) == TRUE)
			{
				aulCurrentValue[ucCount] = mstWashMotorInfo.unMotorCurrent;
				ucCount++;
			}
			else
			{
				;	///< Do Nothing
			}

			if(ucCount >= MEASUREMENT_CURRENT_COUNT_MAX)
			{
				ucCount = 0;
				_Get_BubbleSortingData(aulCurrentValue, MEASUREMENT_CURRENT_COUNT_MAX);
				ulAverageCurrent = (	aulCurrentValue[2] + aulCurrentValue[3] + aulCurrentValue[4] +
										aulCurrentValue[5] + aulCurrentValue[6] + aulCurrentValue[7]	) / 6;
				mstWashMotorInfo.unMotorAerageCurrent = (UINT16)ulAverageCurrent;
			}
			else
			{
				;		///< Do nothing
			}
		}
		else
		{
			ucCount = 0;
			ulAverageCurrent = 0;
			mstWashMotorInfo.unMotorAerageCurrent = 0;
		}
	}
	else
	{
		ucCount = 0;
		ulAverageCurrent = 0;
		mstWashMotorInfo.unMotorAerageCurrent = 0;
		Timer_GetTime(&stTimerCurrentDataTime);
	}
}

/* End of File */
