/*
 * DrainMotor_DC.c
 *
 *  Created on: 2013. 7. 18.
 *      Author: seongju.lim
 */

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"
#include "./Timer.h"


/* --------------- Define 정의  ---------------  */
#define MEASUREMENT_CURRENT_COUNT_MAX		(10)


/* --------------- Typedef형 정의  ---------------  */
typedef struct
{
	BOOL bIsOn;							// 배수모터 On/Off 상태
	BOOL bDirectionCCW;					// 배수모터 회전방향 (CCW : 1, CW : 0)
	UINT16 unTargetRPM;					// 배수모터 Target RPM
	UINT16 unCurrentRPM;				// 배수모터 현재 RPM
	UINT16 unRequestRPM;				// 배수모터 속도제어기 Request RPM
	UINT16 unMotorCurrent;				// 배수모터 전류값
	UINT16 unMotorAerageCurrent;		// 배수모터 평균 전류값
	UINT16 unMotorWatt;					// 배수모터 Watt
} T_DrainMotorDevice;


/* --------------- 함수 원형 정의  ---------------  */
static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize);


/* --------------- 전역 변수 정의  ---------------  */
static T_DrainMotorDevice mstDrainMotorInfo;



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
* @fn UINT16 DrainMotor_DC_GetCurRPM(void)
* DrainMotor_DC 현재 RPM 값 Return 함수
* @param	없음
* @return	unCurrentRPM		DrainMotor_DC 현재 RPM 값
* @see
*/
UINT16 DrainMotor_DC_GetCurRPM(void)
{
	return mstDrainMotorInfo.unCurrentRPM;
}

/**
* @fn void DrainMotor_DC_SetCurRPM(UINT16 unDrainMotorRPM)
* DrainMotor_DC 현재 RPM 설정 함수
* @param	현재 RPM
* @return	없음
* @see
*/
void DrainMotor_DC_SetCurRPM(UINT16 unDrainMotorRPM)
{
	mstDrainMotorInfo.unCurrentRPM = unDrainMotorRPM;
}

/**
* @fn UINT16 DrainMotor_DC_GetTarRPM(void)
* DrainMotor_DC Target RPM 값 Return 함수
* @param	없음
* @return	unTargetRPM		DrainMotor_DC Target RPM 값
* @see
*/
UINT16 DrainMotor_DC_GetTarRPM(void)
{
	return mstDrainMotorInfo.unTargetRPM;
}

/**
* @fn void DrainMotor_DC_SetTarRPM(UINT16 unRPM)
* DrainMotor_DC Target RPM 설정 함수
* @param	unRPM		Target RPM
* @return	없음
* @see
*/
void DrainMotor_DC_SetTarRPM(UINT16 unRPM)
{
	mstDrainMotorInfo.unTargetRPM = unRPM;
}

/**
* @fn UINT16 DrainMotor_DC_GetRequestRPM(void)
* DrainMotor_DC Request RPM 값 Return 함수
* @param	없음
* @return	unRequestRPM		DrainMotor_DC Request RPM 값
* @see
*/
UINT16 DrainMotor_DC_GetRequestRPM(void)
{
	return mstDrainMotorInfo.unRequestRPM;
}

/**
* @fn void DrainMotor_DC_SetRequestRPM(UINT16 unRPM)
* DrainMotor_DC Request RPM 설정 함수
* @param	unRPM		Request RPM
* @return	없음
* @see
*/
void DrainMotor_DC_SetRequestRPM(UINT16 unRPM)
{
	mstDrainMotorInfo.unRequestRPM = unRPM;
}

/**
* @fn UINT16 DrainMotor_DC_GetMotorCurrent(void)
* DrainMotor_DC Current 값 Return 함수
* @param	없음
* @return	unMotorCurrent		DrainMotor_DC Current 값
* @see
*/
UINT16 DrainMotor_DC_GetMotorCurrent(void)
{
	return mstDrainMotorInfo.unMotorCurrent;
}

/**
* @fn void DrainMotor_DC_SetMotorCurrent(UINT16 unCurrent)
* DrainMotor_DC Motor Current 설정 함수
* @param	unCurrent		Motor Current
* @return	없음
* @see
*/
void DrainMotor_DC_SetMotorCurrent(UINT16 unCurrent)
{
	mstDrainMotorInfo.unMotorCurrent = unCurrent;
}

/**
* @fn void DrainMotor_DC_Init(void)
* DrainMotor_DC 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void DrainMotor_DC_Init(void)
{
	mstDrainMotorInfo.bIsOn = FALSE;
	mstDrainMotorInfo.bDirectionCCW = FALSE;
	mstDrainMotorInfo.unTargetRPM = 0;
	mstDrainMotorInfo.unCurrentRPM = 0;
	mstDrainMotorInfo.unRequestRPM = 0;
	mstDrainMotorInfo.unMotorCurrent = 0;
	mstDrainMotorInfo.unMotorAerageCurrent = 0;
	mstDrainMotorInfo.unMotorWatt = 0;
}

/**
* @fn void DrainMotor_DC_TurnOn(void)
* DrainMotor_DC Turn On 함수
* @param	없음
* @return	없음
* @see
*/
void DrainMotor_DC_TurnOn(void)
{
	mstDrainMotorInfo.bIsOn = TRUE;
}

/**
* @fn void DrainMotor_DC_TurnOff(void)
* DrainMotor_DC Turn Off 함수
* @param	없음
* @return	없음
* @see
*/
void DrainMotor_DC_TurnOff(void)
{
	mstDrainMotorInfo.bIsOn = FALSE;
}

/**
* @fn BOOL DrainMotor_DC_IsOn(void)
* DrainMotor_DC 상태변수값 Return 함수
* @param	없음
* @return	mb_IsOn		DrainMotor_DC 상태 값 (1 : On, 0 : Off)
* @see
*/
BOOL DrainMotor_DC_IsOn(void)
{
	return mstDrainMotorInfo.bIsOn;
}

/**
* @fn void DrainMotor_DC_DirectionCCW(void)
* DrainMotor_DC 회전방향 설정 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	없음
* @see
*/
void DrainMotor_DC_DirectionCCW(void)
{
	mstDrainMotorInfo.bDirectionCCW = TRUE;
}

/**
* @fn void DrainMotor_DC_DirectionCW(void)
* DrainMotor_DC 회전방향 설정 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	없음
* @see
*/
void DrainMotor_DC_DirectionCW(void)
{
	mstDrainMotorInfo.bDirectionCCW = FALSE;
}

/**
* @fn BOOL DrainMotor_DC_IsDirectionCCW(void)
* DrainMotor_DC 회전방향 Return 함수 (CCW : 1, CW : 0)
* @param	없음
* @return	bDirectionCCW	DrainMotor_DC 회전방향
* @see
*/
BOOL DrainMotor_DC_IsDirectionCCW(void)
{
	return mstDrainMotorInfo.bDirectionCCW;
}

/**
* @fn UINT16 DrainMotor_DC_GetMotorWatt(void)
* DrainMotor Motor Watt 값 Return 함수
* @param	없음
* @return	unMotorWatt		DrainMotor Watt 값
* @see
*/
UINT16 DrainMotor_DC_GetMotorWatt(void)
{
	return mstDrainMotorInfo.unMotorWatt;
}

/**
* @fn void DrainMotor_DC_SetMotorWatt(UINT16 unWatt)
* DrainMotor Motor Watt 설정 함수
* @param	unWatt		Motor Watt
* @return	없음
* @see
*/
void DrainMotor_DC_SetMotorWatt(UINT16 unWatt)
{
	mstDrainMotorInfo.unMotorWatt = unWatt;
}

/**
* @fn UINT16 DrainMotor_DC_GetMotorWatt(void)
* DrainMotor Motor 평균 전류값 Return 함수
* @param	없음
* @return	unMotorAerageCurrent		DrainMotor 평균 전류값
* @see
*/
UINT16 DrainMotor_DC_GetMotorAverageCurrent(void)
{
	return mstDrainMotorInfo.unMotorAerageCurrent;
}

/**
* @fn void DrainMotor_DC_RegularControl(void)
* DrainMotor 평균 전류값 계산 함수
* @param	없음
* @return	없음
* @see
*/
void DrainMotor_DC_RegularControl(void)
{
	static UINT8 ucCount;
	static UINT32 aulCurrentValue[10] = {0, };
	static UINT32 ulAverageCurrent;
	static T_Time stTimerCurrentDataTime;

	if(mstDrainMotorInfo.bIsOn == TRUE)
	{
		if(	(mstDrainMotorInfo.unRequestRPM >= 3200) && (mstDrainMotorInfo.unCurrentRPM >= 1500) )
		{
			if(Timer_MsecCheckPassTime(&stTimerCurrentDataTime, 100, UPDATE) == TRUE)
			{
				aulCurrentValue[ucCount] = mstDrainMotorInfo.unMotorCurrent;
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
				mstDrainMotorInfo.unMotorAerageCurrent = (UINT16)ulAverageCurrent;
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
			mstDrainMotorInfo.unMotorAerageCurrent = 0;
		}
	}
	else
	{
		ucCount = 0;
		ulAverageCurrent = 0;
		mstDrainMotorInfo.unMotorAerageCurrent = 0;
		Timer_GetTime(&stTimerCurrentDataTime);
	}
}

/* End of File */
