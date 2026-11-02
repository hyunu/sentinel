/*
 * Sensor_DCLink.c
 *
 *  Created on: 2013. 7. 12.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"


/* --------------- Define 정의  ---------------  */
#define	DCLINK_ARRAY_START_INDEX	(0)
#define	DCLINK_ARRAY_END_INDEX		(30)
#define	DCLINK_ARRAY_INDEX_12		(12)
#define	DCLINK_ARRAY_INDEX_13		(13)
#define	DCLINK_ARRAY_INDEX_14		(14)
#define	DCLINK_ARRAY_INDEX_15		(15)
#define	DCLINK_ARRAY_INDEX_16		(16)
#define	DCLINK_ARRAY_INDEX_17		(17)
#define	DCLINK_READ_COUNT			(30)	// DC-Link 전압 읽는 횟수
#define	DCLINK_AVGCOUNT				(6)		// DC-Link 전압 평균 내기 위해 나누는 값
#define	DCLINK_FIRST_READ_GAP		(1)		// 100 ms
#define	DCLINK_READ_GAP				(1)		// 100 ms

#define ADDVALUE_DCLINK				(150)
#define DCLINK_TABLE_MAX			(256)

#define DCLINK_INITIAL_MINVALUE		(0)
#define DCLINK_INITIAL_MAXVALUE		(65535)

/* --------------- Typedef형 정의  ---------------  */
typedef enum
{
	REQUEST_NONE = 0,
	REQUEST_START
} T_E_ACVOLTAGE_REQUESTS;

typedef enum
{
	STATE_INIT = 0,
	STATE_CHECK_100ms,
	STATE_FINAL
} T_E_ACVOLTAGE_STEP;

/* --------------- 전역 변수 정의  ---------------  */
static T_E_ACVOLTAGE_REQUESTS meACVoltageMeasurementRequest;
static T_E_ACVOLTAGE_STEP meACVoltageMeasurementState;
static double mdACVoltageValue = (220.0);
static UINT8 muc100msCheck;
static UINT16 munDCLinkValue_SSLSMotor;
static UINT16 munMaxDCLinkValue_SSLSMotor;
static UINT16 munMinDCLinkValue_SSLSMotor;

/* --------------- 함수 원형 정의  ---------------  */
static void _StateMachine_Sensor_DCLink_Check(void);
static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize);


/**
* @fn void Sensor_DCLink_Init(void)
* Sensor_DCLink 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void Sensor_DCLink_Init(void)
{
	meACVoltageMeasurementState = STATE_INIT;
	meACVoltageMeasurementRequest = REQUEST_NONE;
	munMaxDCLinkValue_SSLSMotor = DCLINK_INITIAL_MINVALUE;	// 초기값으로 0을 입력
	munMinDCLinkValue_SSLSMotor = DCLINK_INITIAL_MAXVALUE;	// 초기값으로 65535를 입력(2Byte 최대값)
}

/**
* @fn UINT16 Sensor_DCLink_GetDCLinkVolt(void)
* Sensor_DCLink 변환값 Return 함수
* @param	없음
* @return	unReturn		DCLink 변환값(Voltage)
* @see
*/
UINT16 Sensor_DCLink_GetDCLinkVolt(void)
{
	double dTemp = (double)munDCLinkValue_SSLSMotor;

	// DC Link Voltage	= ((dTemp)/>>4) * ((3000000+33000)/33000) * (5/4095)
	//					= dTemp * ((3000000+33000)*5) / (16*33000*4095)
	//					= dTemp * 15165000 / 2162160000
	//					= dTemp * 0.00701381951381951381951381951382

	return (UINT16)(dTemp * 0.00701381951381951381951381951382);
}

/**
* @fn UINT16 Sensor_DCLink_GetDCLinkVolt(void)
* Sensor_DCLink 변환값 Return 함수
* @param	없음
* @return	unReturn		DCLink 변환값(Voltage)
* @see
*/
UINT16 Sensor_DCLink_GetMaxDCLinkVolt(void)
{
	double dTemp = (double)munMaxDCLinkValue_SSLSMotor;

	// DC Link Voltage	= ((dTemp)/>>4) * ((3000000+33000)/33000) * (5/4095)
	//					= dTemp * ((3000000+33000)*5) / (16*33000*4095)
	//					= dTemp * 15165000 / 2162160000
	//					= dTemp * 0.00701381951381951381951381951382

	return (UINT16)(dTemp * 0.00701381951381951381951381951382);
}

/**
* @fn UINT16 Sensor_DCLink_GetDCLinkVolt(void)
* Sensor_DCLink 변환값 Return 함수
* @param	없음
* @return	unReturn		DCLink 변환값(Voltage)
* @see
*/
UINT16 Sensor_DCLink_GetMinDCLinkVolt(void)
{
	double dTemp = (double)munMinDCLinkValue_SSLSMotor;

	// DC Link Voltage	= ((dTemp)/>>4) * ((3000000+33000)/33000) * (5/4095)
	//					= dTemp * ((3000000+33000)*5) / (16*33000*4095)
	//					= dTemp * 15165000 / 2162160000
	//					= dTemp * 0.00701381951381951381951381951382

	return (UINT16)(dTemp * 0.00701381951381951381951381951382);
}

/**
* @fn double Sensor_DCLink_GetACVoltage(void)
* AC전압 Return 함수
* @param	없음
* @return	AC전압
* @see		AC전압 Return 함수
*/
double Sensor_DCLink_GetACVoltage(void)
{
	return mdACVoltageValue;
}

/**
* @fn void Sensor_DCLink_RequestACVoltage(void)
* AC전압 측정 시작 요청 함수
* @param	없음
* @return	없음
* @see		AC전압 측정 시작 요청 함수
*/
void Sensor_DCLink_RequestACVoltage(void)
{
	meACVoltageMeasurementState = STATE_INIT;
	meACVoltageMeasurementRequest = REQUEST_START;
}

/**
* @fn void Sensor_DCLink_IsCompleteACVoltage(void)
* AC전압 측정 완료 여부 확인 함수
* @param	없음
* @return	완료시 True, 미완료시 FALSE
* @see		AC전압 측정 완료 여부 확인 함수
*/
BOOL Sensor_DCLink_IsCompleteACVoltage(void)
{
	return (meACVoltageMeasurementState == STATE_FINAL);
}

/**
* @fn void Sensor_DCLink_RegularControl(void)
* AC전압 측정 동작 함수
* @param	없음
* @return	없음
* @see		AC전압 측정 동작 함수
*/
void Sensor_DCLink_RegularControl(void)
{
	if(meACVoltageMeasurementRequest == REQUEST_START)
	{
		_StateMachine_Sensor_DCLink_Check();
	}
	else
	{
		;	///do nothing
	}
}

/**
* @fn void Sensor_DCLink_Isr_Timer_100ms_CheckTimer(void)
* AC전압 측정 100ms 타이머 감지 인터럽트
* @param	없음
* @return	없음
* @see		AC전압 측정 100ms 타이머 감지 인터럽트
*/
void Sensor_DCLink_Isr_Timer_100ms_CheckTimer(void)
{
	if(muc100msCheck > 0)
	{
		muc100msCheck-- ;
	}
	else
	{
		; ///do nothing
	}
}

static void _StateMachine_Sensor_DCLink_Check(void)
{
	static UINT8 ucReadCount;
	static UINT32 aulReadValue[DCLINK_ARRAY_END_INDEX] = {0,};
	UINT32 ulTempSum = CLEAR;

	switch(meACVoltageMeasurementState)
	{
		case STATE_INIT:
			ucReadCount = 0;
			muc100msCheck = DCLINK_FIRST_READ_GAP;
			meACVoltageMeasurementState = STATE_CHECK_100ms;
		break;

		case STATE_CHECK_100ms:
			if(muc100msCheck == 0)
			{
				muc100msCheck = DCLINK_READ_GAP;			/* DC Link 전압을 100ms 간격으로 30번 읽음 */
				aulReadValue[ucReadCount] = munDCLinkValue_SSLSMotor;
				ucReadCount++;
				if(ucReadCount >= DCLINK_ARRAY_END_INDEX)		/* 30회를 읽었을 경우 다음 스텝으로 넘어간다 */
				{
					/* 상 하한 12개를 버리고 가운데 6개의 값의 평균을 구함 */
					_Get_BubbleSortingData(aulReadValue, DCLINK_ARRAY_END_INDEX);
					ulTempSum = aulReadValue[DCLINK_ARRAY_INDEX_12] + aulReadValue[DCLINK_ARRAY_INDEX_13] +	\
								aulReadValue[DCLINK_ARRAY_INDEX_14] + aulReadValue[DCLINK_ARRAY_INDEX_15] +	\
								aulReadValue[DCLINK_ARRAY_INDEX_16] + aulReadValue[DCLINK_ARRAY_INDEX_17];
					// AC Voltage 계산식
					// DC Link Voltage	= ((ulTempSum/6)>>4) * ((3000000+33000)/33000) * (5/4095)
					//					= ulTempSum * ((3000000+33000)*5) / (6*16*33000*4095)
					//					= ulTempSum * 15165000 / 12972960000
					//					= ulTempSum * 0.00116896991896991896991896991897
					// AC Voltage	= (DC Link Voltage + 2*0.7) / √2
					//				= (ulTempSum * 0.00116896991896991896991896991897 + 1.4) / (1.4142135623730950488016887242097)
					mdACVoltageValue = ((double)ulTempSum * (0.00116896991896991896991896991897) + 1.4) / (1.4142135623730950488016887242097);
					meACVoltageMeasurementState = STATE_FINAL;
				}
				else
				{
					;	///< Do nothing
				}
			}
			else
			{
				;	///< Do nothing
			}
		break;

		case STATE_FINAL :
			meACVoltageMeasurementRequest = REQUEST_NONE; // AC전압 측정 완료 후, 요청Flag clear
		break;

		default:
		break;
	}
}

/**
* @fn static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize)
* AC Voltage 측정 내에서 사용하는 AC Voltage Data 정렬
* @param	pulSortingSource 	정렬할 원본 데이터
* @return	정렬된 데이터
* @see		버블 정렬
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
* @fn void Set_DCLink_AD_Value(UINT16 unTemp)
*  Set DCLink 
*  AD DCLink ADC값(12bit) << 4
* @param
* @return	unReturn
* @see
* @remarks	
**/
void Set_DCLink_AD_Value(UINT16 unTemp)
{
	munDCLinkValue_SSLSMotor = unTemp;

	if(unTemp > munMaxDCLinkValue_SSLSMotor)
	{
		munMaxDCLinkValue_SSLSMotor = unTemp;
	}
	else
	{
		;
	}
	
	if(unTemp < munMinDCLinkValue_SSLSMotor)
	{
		munMinDCLinkValue_SSLSMotor = unTemp;
	}
	else
	{
		;
	}
}
