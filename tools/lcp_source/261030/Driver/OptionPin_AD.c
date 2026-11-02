/*
 * OptionPin_AD.c
 *
 *  Created on: 2021. 9. 10.
 *      Author: hyuntaek.cho
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "OptionPin_AD.h"


/* --------------- Define 정의  ---------------  */
#define AD_COUNT_MAX		(20)
#define AD_OPTION_STEP		(10)

/* --------------- Typedef형 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */
static const UINT8 maucADStepTable[AD_OPTION_STEP] = { 34, 55, 79, 103, 128, 152, 177, 200, 222, 255 };

/* --------------- 함수 원형 정의  ---------------  */
static void _AD_SetPort(UINT8 ucADOptionPin);
static UINT16 _AD_ReadPort(UINT8 ucADOptionPin);
static UINT8 _AD_GetADCValue(UINT8 ucADOptionPin);


/**
* @fn UINT8 OptionPin_AD_Chattering(UINT8 ucADOptionPin)
* AD Option Pin Chattering 함수, 20회 연속 동일 Step인 경우 완료
* @param	UINT8				Option Pin No.
* @return	UINT8				AD Step (0~9)
* @see
*/
UINT8 OptionPin_AD_Chattering(UINT8 ucADOptionPin)
{
	UINT8 ucRetData = 0, ucAdCount = 0, ucADValue = 0;
	UINT8 uci = 0;

	while(ucAdCount < AD_COUNT_MAX)
	{
		ucADValue = _AD_GetADCValue(ucADOptionPin);

		for(uci = 0; uci < AD_OPTION_STEP; uci++)
		{
			if(ucADValue <= maucADStepTable[uci])
			{
				break;
			}
			else
			{
				;
			}
  		}

		if(ucRetData == uci)
		{
			ucAdCount++;
		}
		else
		{
			ucAdCount = 0;
			ucRetData = uci;
		}
	}

	return ucRetData;
}

static void _AD_SetPort(UINT8 ucADOptionPin)
{
	switch(ucADOptionPin)
	{
		case AD_OPTIONPIN_1:
			S12AD.ADANSA1.WORD = 0x0800;	// AN027
		break;

		case AD_OPTIONPIN_2:
			S12AD.ADANSA1.WORD = 0x1000;	// AN028
		break;

		case AD_OPTIONPIN_3:
			S12AD.ADANSA1.WORD = 0x2000;	// AN029
		break;

		default:
		break;
	}
}

static UINT16 _AD_ReadPort(UINT8 ucADOptionPin)
{
	UINT16 unRetValue = 0;

	switch(ucADOptionPin)
	{
		case AD_OPTIONPIN_1:
			unRetValue = (UINT16)S12AD.ADDR27;
		break;

		case AD_OPTIONPIN_2:
			unRetValue = (UINT16)S12AD.ADDR28;
		break;

		case AD_OPTIONPIN_3:
			unRetValue = (UINT16)S12AD.ADDR29;
		break;

		default:
		break;
	}

	return unRetValue;
}

static UINT8 _AD_GetADCValue(UINT8 ucADOptionPin)
{
	UINT16 unRetValue = CLEAR;

	if(ucADOptionPin >= AD_OPTIONPIN_MAX)
	{
		;
	}
	else
	{
		_AD_SetPort(ucADOptionPin);

		S12AD.ADCSR.BIT.ADST = 1;				// Start AD conversion

		while(S12AD.ADCSR.BIT.ADST == 1)
		{
			;	///< Do nothing
		};

		unRetValue = _AD_ReadPort(ucADOptionPin);	// 12 bit AD;
	}

	return (UINT8)((unRetValue & 0x0FFF) >> 4);			// 8 bit AD;
}
