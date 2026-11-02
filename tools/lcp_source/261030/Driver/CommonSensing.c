/*
 * CommonSensing.c
 *
 *  Created on: 2013. 11. 6.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "./Sensor_HeatDryTemperature.h"
#include "./Sensor_SteamTemperature.h"
#include "./Sensor_SumpTemperature.h"


#define AD_COUNT_MAX		(16)
#define READ_SENSOR_GAP		(1)
#define	AD_DEFAULT_VALUE	(0)

#define ADCHANNEL_AN0	(0x01)
#define ADCHANNEL_AN1	(0x02)
#define ADCHANNEL_AN2	(0x04)
#define ADCHANNEL_AN3	(0x08)
//#define ADCHANNEL_AN4	(0x10)	//	주위 : Steam Water 유/무는 일반 I/O를 사용
//#define ADCHANNEL_AN5	(0x20)
//#define ADCHANNEL_AN6	(0x40)
//#define ADCHANNEL_AN7	(0x80)

typedef enum
{
	SENSINGSTATE_INITIAL = 0,
	SENSINGSTATE_RUNNING
} T_E_SensingState;

/**
 * AD 부하 리스트
 */
/* Turbidity Sensor 정보는  TurbiditySensor.c file 참조 */
typedef enum
{
    AD_SUMPTEMPSENSOR = 0,
    AD_HEATDRYTEMPSENSOR,
	AD_STEAMTEMPSENSOR,
	AD_MAX
} T_E_ADName;

/**
 * AD를 위한 정보 테이블
 */
static const UINT16 mastADInfo[AD_MAX] =
{
/* AD Name, 				AD Channel */
/* AD_SUMPTEMPSENSOR		*/	ADCHANNEL_AN2,
/* AD_HEATDRYTEMPSENSOR		*/	ADCHANNEL_AN1,
/* AD_STEAMTEMPSENSOR		*/	ADCHANNEL_AN3,
};

static UINT8 mucAD10msCheck;
static T_E_SensingState meSensingStep;

static UINT16 _Sensor_ReadPort(UINT16 unADChannel);
static void _SaveFinalValue(UINT8 ucADName, UINT16 unFinalValue);
static INT32 _GetAdcLimitValue(UINT8 ucADName, UINT16 unPreFinalValue);

/**
* @fn void CommonSensing_Init(void)
* CommonSensing 의 SensingStep 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void CommonSensing_Init(void)
{
	meSensingStep = SENSINGSTATE_INITIAL;
}

/**
* @fn void CommonSensing_ISR_Timer_10ms_DecreaseCount(void)
* 10ms 마다 호출되는 함수
* @param	없음
* @return	없음
* @see
*/
void CommonSensing_ISR_Timer_10ms_DecreaseCount(void)
{
	if (mucAD10msCheck > CLEAR)
	{
		mucAD10msCheck--;
	}
	else
	{
		;	///< Do nothing
	}
}

/**
* @fn void CommonSensing_RegularControl(void)
* Regular Control 에서 main 주기마다 실행하는 함수
* @param	없음
* @return	없음
* @see
*/
void CommonSensing_RegularControl(void)
{
	UINT16 unFinalValue = 0;
	static UINT8 ucADName;
	static UINT32 aulAdcSumdata[AD_MAX];
	static UINT16 aunAdcData[AD_MAX][AD_COUNT_MAX];
	static UINT8 uci = AD_MAX;
	static UINT16 unChannel;
	static UINT8 ucADCCount;
	UINT16 unPreFinalValue = 0;
	INT32 lAdcTempValue = 0;
	INT32 lAdcLimitValue = 0;
	INT32 lAdcMaxLimitValue = 0;
	INT32 lAdcMinLimitValue = 0;
	UINT8 ucj = 0;

	if (mucAD10msCheck <= 0)
	{
		mucAD10msCheck = READ_SENSOR_GAP;

		switch(meSensingStep)
		{
			case SENSINGSTATE_INITIAL:
				for(uci = AD_SUMPTEMPSENSOR ; uci < AD_MAX ; uci++)
				{
					unChannel = mastADInfo[uci];
					unFinalValue = _Sensor_ReadPort(unChannel);
					_SaveFinalValue(uci, unFinalValue);
					aulAdcSumdata[uci] = (((UINT32)unFinalValue) * AD_COUNT_MAX);

					for(ucj = 0; ucj < AD_COUNT_MAX; ucj++)
					{
						aunAdcData[uci][ucj] = unFinalValue;
					}
				}

				ucADCCount = 0;
				meSensingStep = SENSINGSTATE_RUNNING;
				ucADName = AD_SUMPTEMPSENSOR;
			break;

			case SENSINGSTATE_RUNNING:
				unChannel = mastADInfo[ucADName];
				unPreFinalValue = (UINT16)(aulAdcSumdata[ucADName] >> 4);
				aulAdcSumdata[ucADName] -= aunAdcData[ucADName][ucADCCount];
				lAdcTempValue = (INT32)_Sensor_ReadPort(unChannel);

				lAdcLimitValue = _GetAdcLimitValue(ucADName, unPreFinalValue);
				lAdcMaxLimitValue = (INT32)unPreFinalValue + lAdcLimitValue;
				lAdcMinLimitValue = (INT32)unPreFinalValue - lAdcLimitValue;
				if(lAdcTempValue > lAdcMaxLimitValue)
				{
					lAdcTempValue = (lAdcMaxLimitValue > 0x0FFF) ? 0x0FFF : lAdcMaxLimitValue;
				}
				else if(lAdcTempValue < lAdcMinLimitValue)
				{
					lAdcTempValue = (lAdcMinLimitValue < 0) ? 0 : lAdcMinLimitValue;
				}
				else
				{
					;	///< Do Nothing
				}

				aunAdcData[ucADName][ucADCCount] = (UINT16)lAdcTempValue;
				aulAdcSumdata[ucADName] += aunAdcData[ucADName][ucADCCount];
				unFinalValue = (UINT16)(aulAdcSumdata[ucADName] >> 4);
				_SaveFinalValue(ucADName, unFinalValue);
				ucADName++;

				if(ucADName >= AD_MAX)
				{
					ucADCCount++;
					ucADName = AD_SUMPTEMPSENSOR;

					if(ucADCCount >= AD_COUNT_MAX)
					{
						ucADCCount = 0;
					}
					else
					{
						;	///< Do Nothing
					}
				}
				else
				{
					;	///< Do Nothing
				}
			break;

			default:
			break;
		}
	}
	else
	{
		;	///< Do nothing
	}
}

/**
* @fn static UINT8 _Sensor_ReadPort(UINT8 ucADChannel)
* AD Channel 을 받아 AD 값을 읽는 함수
* @param	ucADChannel		Sensor 종류 별 AD Channel
* @return	unRetValue		Port 에서 읽은 Sensor 값
* @see
*/
static UINT16 _Sensor_ReadPort(UINT16 unADChannel)
{
	UINT16 unRetValue = CLEAR;

	S12AD.ADANSA0.WORD = (unADChannel & 0x0FFF);	// Set channel number
	S12AD.ADCSR.BIT.ADST = 1;

#ifdef __SILS__
#else
	while(S12AD.ADCSR.BIT.ADST == 1)
	{
		;	///< Do nothing
	};
#endif

	switch(unADChannel)
	{
		case ADCHANNEL_AN0:
			unRetValue = (UINT16)S12AD.ADDR0;
		break;

		case ADCHANNEL_AN1:
			unRetValue = (UINT16)S12AD.ADDR1;
		break;

		case ADCHANNEL_AN2:
			unRetValue = (UINT16)S12AD.ADDR2;
		break;

		case ADCHANNEL_AN3:
			unRetValue = (UINT16)S12AD.ADDR3;
		break;

//		case ADCHANNEL_AN4:
//			unRetValue = (UINT16)S12AD.ADDR4;
//		break;
//
//		case ADCHANNEL_AN5:
//			unRetValue = (UINT16)S12AD.ADDR5;
//		break;
//
//		case ADCHANNEL_AN6:
//			unRetValue = (UINT16)S12AD.ADDR6;
//		break;
//
//		case ADCHANNEL_AN7:
//			unRetValue = (UINT16)S12AD.ADDR7;
//		break;
        
		default:
			unRetValue = AD_DEFAULT_VALUE;
		break;
	}

	return (unRetValue & 0x0FFF);		// 12 bit AD
}

/**
* @fn static void _SaveFinalValue(UINT8 ucADName, UINT8 ucFinalValue)
* Sensor 별 16개 data 를 평균한 최종값을 전달하는 함수
* @param	ucADName		Sensor 종류 별 AD Name
* @param	ucFinalValue	16개 data 를 평균한 최종 값
* @return	없음
* @see
*/
static void _SaveFinalValue(UINT8 ucADName, UINT16 unFinalValue)
{
	switch(ucADName)
	{
		case AD_SUMPTEMPSENSOR:
			Sensor_SumpTemperature_SetValue(unFinalValue >> 4); // 12bit -> 8bit 변환
		break;

		case AD_HEATDRYTEMPSENSOR:
			Sensor_HeatDryTemperature_SetValue(unFinalValue >> 4);	// 12bit -> 8bit 변환
		break;

		case AD_STEAMTEMPSENSOR:
			Sensor_SteamTemperature_SetValue(unFinalValue >> 4);	// 12bit -> 8bit 변환
		break;

		default:
		break;
	}
}

/**
* @fn static INT32 _GetAdcLimitValue(UINT8 ucADName, UINT16 unPreFinalValue)
* Sensor 별 이전 AD값을 기준으로 AD Limit값을 반환하는 함수
* @param	ucADName			Sensor 종류 별 AD Name
* @param	unPreFinalValue		이전 AD값
* @return	없음
* @see
*/
static INT32 _GetAdcLimitValue(UINT8 ucADName, UINT16 unPreFinalValue)
{
	INT32 lAdcLimitValue = 0x0FFF;		// 12bit MAX

	switch(ucADName)
	{
		case AD_SUMPTEMPSENSOR:
			lAdcLimitValue = (INT32)Sensor_SumpTemperature_GetAdcLimitValue(unPreFinalValue);
		break;

		case AD_HEATDRYTEMPSENSOR:
			lAdcLimitValue = (INT32)Sensor_HeatDryTemperature_GetAdcLimitValue(unPreFinalValue);
		break;

		case AD_STEAMTEMPSENSOR:
			lAdcLimitValue = (INT32)Sensor_SteamTemperature_GetAdcLimitValue(unPreFinalValue);
		break;

		default:
		break;
	}

	return lAdcLimitValue;
}
