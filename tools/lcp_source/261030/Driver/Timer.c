/*
 * Timer.c
 *
 *  Created on: 2013. 8. 28.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "Timer.h"


static T_Time mstTimer_Master = {0, 0};
static T_Time mstTimer_Process = {0, 0};


/**
* @fn void Timer_TimeInc(void)
* Internal Timer increment.
* @param	없음
* @return	없음
* @see
*/
void Timer_TimeInc(void)
{
	UINT32 ulTemp = mstTimer_Master.ulLow;	//OverFlow 확인용 변수

	mstTimer_Master.ulLow += 10;		//1ms timer (10msec 단위로 증가 한다.)

	if(ulTemp > mstTimer_Master.ulLow)
	{
		mstTimer_Master.ucHigh++;
	}
	else
	{
		;//do nothing
	}
}

/**
* @fn void ProcessTimer_TimeInc(void)
* Internal Timer increment.
* @param	없음
* @return	없음
* @see
*/
void ProcessTimer_TimeInc(void)
{
	UINT32 ulTemp = mstTimer_Process.ulLow;	//OverFlow 확인용 변수

	mstTimer_Process.ulLow += 10;		//1ms timer (10msec 단위로 증가 한다.)

	if(ulTemp > mstTimer_Process.ulLow)
	{
		mstTimer_Process.ucHigh++;
	}
	else
	{
		;//do nothing
	}
}

/**
* @fn BOOL Timer_MsecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption)
* Msec 단위 Time Check 함수
* @param		T_Time* pstTime  		비교하고자 하는 기준 Time의 포인터
* @param		UINT32 ulTime  	 	비교하고자 하는 경과 시간 (msec 단위, 0 ~ 4294967295)
* @param		UINT8 ucUpdateOption  	리턴값이 참일 때 현재 Time Update 여부 (1이면 업데이트)
* @return	경과했으면 1, 아니면 0
* @see		없음
*/
BOOL Timer_MsecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption)
{
	BOOL bReturn = FALSE;
	static	T_Time	stTempTime;
	static	T_Time	stCurrentTime;

	stCurrentTime.ulLow = mstTimer_Master.ulLow;
	stCurrentTime.ucHigh = mstTimer_Master.ucHigh;

	if((mstTimer_Master.ulLow != stCurrentTime.ulLow) || (mstTimer_Master.ucHigh != stCurrentTime.ucHigh) )
	{
		// 인터럽트 호출로 mstTime과 값 복사 된 CurrentTime이 달라지는 경우
		// 8Bit 마이컴의 경우, 2byte씩 값이 Assign 될 때 인터럽트 발생 되면, 잘못된 값으로 Assign 됨.
		// Ex) 0x0000FFFF -> 0x001FFFF이 발생 될 경우를 방지 하기 위하여, mstTime값을 다시 받는다.
		stCurrentTime.ulLow = mstTimer_Master.ulLow;
		stCurrentTime.ucHigh = mstTimer_Master.ucHigh;
	}
	else
	{
		;///do nothing
	}

	stTempTime.ulLow = pstTime->ulLow + ulTime;		//target time set
	stTempTime.ucHigh = pstTime->ucHigh;

	if((stTempTime.ulLow < pstTime->ulLow) || (stTempTime.ulLow < ulTime))
	{
		stTempTime.ucHigh++;
	}
	else
	{
		;//do nothing
	}

	if(stCurrentTime.ucHigh == stTempTime.ucHigh)
	{
		if (stCurrentTime.ulLow >= stTempTime.ulLow)
		{
			bReturn = TRUE;
		}
		else
		{
			;//do nothing
		}
	}
	else if (stCurrentTime.ucHigh > stTempTime.ucHigh)
	{
		bReturn = TRUE;
	}
	else
	{
		;//do nothing
	}

	if(bReturn == TRUE)
	{
		if(ucUpdateOption == 1)
		{
			pstTime->ucHigh = stCurrentTime.ucHigh;
			pstTime->ulLow = stCurrentTime.ulLow;
		}
		else
		{
			;//do nothing
		}
	}
	else
	{
		;//do nothing
	}

	return bReturn;
}

/**
* @fn BOOL ProcessTimer_MsecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption)
* Msec 단위 Time Check 함수
* @param		T_Time* pstTime  		비교하고자 하는 기준 Time의 포인터
* @param		UINT32 ulTime  	 	비교하고자 하는 경과 시간 (msec 단위, 0 ~ 4294967295)
* @param		UINT8 ucUpdateOption  	리턴값이 참일 때 현재 Time Update 여부 (1이면 업데이트)
* @return	경과했으면 1, 아니면 0
* @see		없음
*/
BOOL ProcessTimer_MsecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption)
{
	BOOL bReturn = FALSE;
	static	T_Time	stTempTime;
	static	T_Time	stCurrentTime;

	stCurrentTime.ulLow = mstTimer_Process.ulLow;
	stCurrentTime.ucHigh = mstTimer_Process.ucHigh;

	if((mstTimer_Process.ulLow != stCurrentTime.ulLow) || (mstTimer_Process.ucHigh != stCurrentTime.ucHigh) )
	{
		// 인터럽트 호출로 mstTime과 값 복사 된 CurrentTime이 달라지는 경우
		// 8Bit 마이컴의 경우, 2byte씩 값이 Assign 될 때 인터럽트 발생 되면, 잘못된 값으로 Assign 됨.
		// Ex) 0x0000FFFF -> 0x001FFFF이 발생 될 경우를 방지 하기 위하여, mstTime값을 다시 받는다.
		stCurrentTime.ulLow = mstTimer_Process.ulLow;
		stCurrentTime.ucHigh = mstTimer_Process.ucHigh;
	}
	else
	{
		;///do nothing
	}
	stTempTime.ulLow = pstTime->ulLow + ulTime;		//target time set
	stTempTime.ucHigh = pstTime->ucHigh;

	if((stTempTime.ulLow < pstTime->ulLow) || (stTempTime.ulLow < ulTime))
	{
		stTempTime.ucHigh++;
	}
	else
	{
		;//do nothing
	}

	if(stCurrentTime.ucHigh == stTempTime.ucHigh)
	{
		if (stCurrentTime.ulLow >= stTempTime.ulLow)
		{
			bReturn = TRUE;
		}
		else
		{
			;//do nothing
		}
	}
	else if (stCurrentTime.ucHigh > stTempTime.ucHigh)
	{
		bReturn = TRUE;
	}
	else
	{
		;//do nothing
	}

	if(bReturn == TRUE)
	{
		if(ucUpdateOption == 1)
		{
			pstTime->ucHigh = stCurrentTime.ucHigh;
			pstTime->ulLow = stCurrentTime.ulLow;
		}
		else
		{
			;//do nothing
		}
	}
	else
	{
		;//do nothing
	}

	return bReturn;
}

/**
* @fn BOOL Timer_HourCheckPassTime(T_Time* pstTime, UINT8 ucTime, UINT8 ucUpdateOption)
* Hour 단위 Time Check 함수
* @param		T_Time* pstTime  비교하고자 하는 기준 Time의 포인터
* @param		UINT8 ucTime  	 비교하고자 하는 경과 시간 (hour 단위, 0 ~ 255)
* @param		UINT8 ucUpdateOption  	리턴값이 참일 때 현재 Time Update 여부 (1이면 업데이트)
* @return	경과했으면 1, 아니면 0
* @see		없음
*/
BOOL Timer_HourCheckPassTime(T_Time* pstTime, UINT8 ucTime, UINT8 ucUpdateOption)
{
	return Timer_MsecCheckPassTime(pstTime, (UINT32)ucTime * 3600000, ucUpdateOption);
}

/**
* @fn BOOL ProcessTimer_HourCheckPassTime(T_Time* pstTime, UINT8 ucTime, UINT8 ucUpdateOption)
* Hour 단위 Time Check 함수
* @param		T_Time* pstTime  비교하고자 하는 기준 Time의 포인터
* @param		UINT8 ucTime  	 비교하고자 하는 경과 시간 (hour 단위, 0 ~ 255)
* @param		UINT8 ucUpdateOption  	리턴값이 참일 때 현재 Time Update 여부 (1이면 업데이트)
* @return	경과했으면 1, 아니면 0
* @see		없음
*/
BOOL ProcessTimer_HourCheckPassTime(T_Time* pstTime, UINT8 ucTime, UINT8 ucUpdateOption)
{
	return ProcessTimer_MsecCheckPassTime(pstTime, (UINT32)ucTime * 3600000, ucUpdateOption);
}

/**
* @fn BOOL Timer_MinCheckPassTime(T_Time* pstTime, UINT16 unTime, UINT8 ucUpdateOption)
* Min 단위 Time Check 함수
* @param		T_Time* pstTime  비교하고자 하는 기준 Time의 포인터
* @param		UINT16 unTime  	 비교하고자 하는 경과 시간 (Min 단위, 0 ~ 65535)
* @param		UINT8 ucUpdateOption  	리턴값이 참일 때 현재 Time Update 여부 (1이면 업데이트)
* @return	경과했으면 1, 아니면 0
* @see		없음
*/
BOOL Timer_MinCheckPassTime(T_Time* pstTime, UINT16 unTime, UINT8 ucUpdateOption)
{
	return Timer_MsecCheckPassTime(pstTime, (UINT32)unTime * 60000, ucUpdateOption);
}

/**
* @fn BOOL ProcessTimer_MinCheckPassTime(T_Time* pstTime, UINT16 unTime, UINT8 ucUpdateOption)
* Min 단위 Time Check 함수
* @param		T_Time* pstTime  비교하고자 하는 기준 Time의 포인터
* @param		UINT16 unTime  	 비교하고자 하는 경과 시간 (Min 단위, 0 ~ 65535)
* @param		UINT8 ucUpdateOption  	리턴값이 참일 때 현재 Time Update 여부 (1이면 업데이트)
* @return	경과했으면 1, 아니면 0
* @see		없음
*/
BOOL ProcessTimer_MinCheckPassTime(T_Time* pstTime, UINT16 unTime, UINT8 ucUpdateOption)
{
	return ProcessTimer_MsecCheckPassTime(pstTime, (UINT32)unTime * 60000, ucUpdateOption);
}

/**
* @fn BOOL Timer_SecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption)
* Sec 단위 Time Check 함수
* @param		T_Time* pstTime  비교하고자 하는 기준 Time의 포인터
* @param		UINT32 ulTime  	 비교하고자 하는 경과 시간 (sec 단위, 0 ~ 4294967295/1000)
* @param		UINT8 ucUpdateOption  	리턴값이 참일 때 현재 Time Update 여부 (1이면 업데이트)
* @return	경과했으면 1, 아니면 0
* @see		없음
*/
BOOL Timer_SecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption)
{
	return Timer_MsecCheckPassTime(pstTime, (UINT32)ulTime * 1000, ucUpdateOption);
}

/**
* @fn BOOL ProcessTimer_SecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption)
* Sec 단위 Time Check 함수
* @param		T_Time* pstTime  비교하고자 하는 기준 Time의 포인터
* @param		UINT32 ulTime  	 비교하고자 하는 경과 시간 (sec 단위, 0 ~ 4294967295/1000)
* @param		UINT8 ucUpdateOption  	리턴값이 참일 때 현재 Time Update 여부 (1이면 업데이트)
* @return	경과했으면 1, 아니면 0
* @see		없음
*/
BOOL ProcessTimer_SecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption)
{
	return ProcessTimer_MsecCheckPassTime(pstTime, (UINT32)ulTime * 1000, ucUpdateOption);
}

/**
* @fn void Timer_GetTime(T_Time* pstTime)
* 현재 Timer를 얻는다
* @param		T_Time* pstTime  현재 Timer를 저장하고자 하는 Timer 포인터
* @return	없음
* @see					void Timer_SetTime(T_Time* pstTime)
*/
void Timer_GetTime(T_Time* pstTime)
{
	(*pstTime) = mstTimer_Master;			//현재 시간을 저장

	if((mstTimer_Master.ulLow != pstTime->ulLow) || (mstTimer_Master.ucHigh != pstTime->ucHigh) )
	{
		// 인터럽트 호출로 mstTime과 값 복사 된 CurrentTime이 달라지는 경우
		// 8Bit 마이컴의 경우, 2byte씩 값이 Assign 될 때 인터럽트 발생 되면, 잘못된 값으로 Assign 됨.
		// Ex) 0x0000FFFF -> 0x001FFFF이 발생 될 경우를 방지 하기 위하여, mstTime값을 다시 받는다.
		pstTime->ulLow = mstTimer_Master.ulLow;
		pstTime->ucHigh = mstTimer_Master.ucHigh;
	}
	else
	{
		;///do nothing
	}
}

/**
* @fn void ProcessTimer_GetTime(T_Time* pstTime)
* 현재 Timer를 얻는다
* @param		T_Time* pstTime  현재 Timer를 저장하고자 하는 Timer 포인터
* @return	없음
* @see					void Timer_SetTime(T_Time* pstTime)
*/
void ProcessTimer_GetTime(T_Time* pstTime)
{
	(*pstTime) = mstTimer_Process;			//현재 시간을 저장

	if((mstTimer_Process.ulLow != pstTime->ulLow) || (mstTimer_Process.ucHigh != pstTime->ucHigh) )
	{
		// 인터럽트 호출로 mstTime과 값 복사 된 CurrentTime이 달라지는 경우
		// 8Bit 마이컴의 경우, 2byte씩 값이 Assign 될 때 인터럽트 발생 되면, 잘못된 값으로 Assign 됨.
		// Ex) 0x0000FFFF -> 0x001FFFF이 발생 될 경우를 방지 하기 위하여, mstTime값을 다시 받는다.
		pstTime->ulLow = mstTimer_Process.ulLow;
		pstTime->ucHigh = mstTimer_Process.ucHigh;
	}
	else
	{
		;///do nothing
	}
}

/**
* @fn UINT32 ProcessTimer_MsecGetPassedTime(T_Time* pstTime)
* Base Timer와 Process Timer의 시간을 비교하여, 시간 차이를 반환한다.
* @param		T_Time* pstTime  Base Timer
* @return	시간차(ms단위), 최대 반환 시간: 4294967295 ms(약 49.7일)
* @see			없음
*/
UINT32 ProcessTimer_MsecGetPassedTime(T_Time* pstTime)
{
	T_Time stTempTime = mstTimer_Process;
	UINT32 ulReturn = 0;

	if((mstTimer_Process.ulLow != stTempTime.ulLow) || (mstTimer_Process.ucHigh != stTempTime.ucHigh))
	{
		// 인터럽트 호출로 mstTime과 값 복사 된 CurrentTime이 달라지는 경우
		// 8Bit 마이컴의 경우, 2byte씩 값이 Assign 될 때 인터럽트 발생 되면, 잘못된 값으로 Assign 됨.
		// Ex) 0x0000FFFF -> 0x001FFFF이 발생 될 경우를 방지 하기 위하여, mstTime값을 다시 받는다.
		stTempTime.ulLow = mstTimer_Process.ulLow;
		stTempTime.ucHigh = mstTimer_Process.ucHigh;
	}
	else
	{
		;	///do nothing
	}

	if(pstTime->ucHigh == stTempTime.ucHigh)
	{
		if(stTempTime.ulLow >= pstTime->ulLow)		// Base Timer보다 Process Timer가 큰 경우
		{
			ulReturn = stTempTime.ulLow - pstTime->ulLow;
		}
		else
		{
			ulReturn = UINT32_MAX_VALUE;				// 최대로 계산할 수 있는 시간을 지났으므로 최대값을 반환함.
		}
	}
	else
	{
		if(pstTime->ucHigh == UINT8_MAX_VALUE)
		{
			if((stTempTime.ucHigh == 0) && (stTempTime.ulLow < pstTime->ulLow))
			{
				ulReturn = (UINT32_MAX_VALUE - pstTime->ulLow) + stTempTime.ulLow + 1;
			}
			else
			{
				ulReturn = UINT32_MAX_VALUE;			//  최대로 계산할 수 있는 시간을 지났으므로 최대값을 반환함.
			}
		}
		else if(((pstTime->ucHigh + 1) == stTempTime.ucHigh) && (stTempTime.ulLow < pstTime->ulLow))
		{
			ulReturn = (UINT32_MAX_VALUE - pstTime->ulLow) + stTempTime.ulLow + 1;
		}
		else
		{
			ulReturn = UINT32_MAX_VALUE;				//  최대로 계산할 수 있는 시간을 지났으므로 최대값을 반환함.
		}
	}

	return ulReturn;
}
