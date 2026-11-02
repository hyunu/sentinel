/*
 * Sensor_SumpTemperature.c
 *
 *  Created on: 2013. 7. 12.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"


#define	SUMPTHERMISTOR_ADC_FILTER_SCALE		(50)
#define	SUMPTHERMISTOR_ADC_FILTER_DATA		(82)

static UINT8 mucFinalSumpTempValue;
static UINT8 mucMaxSumpTempValue;

static const UINT8 maucSumpTemperatureTable_Steam[] =
{
//	0	1	2	3	4	5	6	7	8	9
	0,	0,	0,	0,	0,	0,	0,	0,	0,	0, 		/* 0 ~ 9 */
	0,	0,	0,	0,	0,	0,	1,	3,	4,	5, 		/* 10 ~ 19 */
	7,	8,	9,	10,	11,	13,	14,	15,	16,	17, 	/* 20 ~ 29 */
	18,	19,	19,	20,	21,	22,	23,	24,	25,	25, 	/* 30 ~ 39 */
	26,	27,	28,	28,	29,	30,	31,	31,	32,	33, 	/* 40 ~ 49 */
	33,	34,	35,	36,	36,	37,	37,	38,	39,	39, 	/* 50 ~ 59 */
	40,	41,	41,	42,	42,	43,	44,	44,	45,	45, 	/* 60 ~ 69 */
	46,	47,	47,	48,	48,	49,	50,	50,	51,	51, 	/* 70 ~ 79 */
	52,	52,	53,	53,	54,	55,	55,	56,	56,	57, 	/* 80 ~ 89 */
	57,	58,	58,	59,	59,	60,	61,	61,	62,	62,		/* 90 ~ 99 */
	63,	63,	64,	64,	65,	65,	66,	66,	67,	67,		/* 100 ~ 109 */
	68,	69,	69,	70,	70,	71,	71,	72,	72,	73,		/* 110 ~ 119 */
	73,	74,	74,	75,	76,	76,	77,	77,	78,	78,		/* 120 ~ 129 */
	79,	79,	80,	80,	81,	82,	82,	83,	83,	84,		/* 130 ~ 139 */
	84,	85,	86,	86,	87,	87,	88,	88,	89,	90,		/* 140 ~ 149 */
	90,	91,	91,	92,	93,	93,	94,	94,	95,	96,		/* 150 ~ 159 */
	96,	97,	98,	98,	99,	100,100,101,102,102,	/* 160 ~ 169 */
	103,104,104,105,106,107,107,108,109,109,	/* 170 ~ 179 */
	110,111,112,112,113,114,115,116,116,117,	/* 180 ~ 189 */
	118,119,120,121,122,123,124,124,125,126,	/* 190 ~ 199 */
	127,128,129,130,131,132,134,135,136,137,	/* 200 ~ 209 */
	138,139,140,142,143,144,146,147,148,150,	/* 210 ~ 219 */
	151,153,155,156,158,160,162,163,165,167,	/* 220 ~ 229 */
	170,172,174,177,179,182,185,188,192,192,	/* 230 ~ 239 */
	195,199,199,199,199,199,199,199,199,199,	/* 240 ~ 249 */
	199,199,199,199,199,199,                    /* 250 ~ 255 */
};

static const UINT8 maucSumpThermistor_Steam_AdcLimit[SUMPTHERMISTOR_ADC_FILTER_DATA] =
{
//	0	1	2	3	4	5	6	7	8	9
	11,	11,	11,	11,	11,	11,	11,	16,	20,	24, 		/* 0 ~ 9	: 0	~ 450		*/
	28,	31,	34,	36,	38,	40,	42,	43,	44,	45, 		/* 10 ~ 29	: 500 ~ 950		*/
	46,	47,	47,	48,	48,	48,	48,	48,	48,	48, 		/* 20 ~ 39	: 1000 ~ 1450	*/
	48,	48,	48,	48,	48,	48,	48,	48,	47,	47, 		/* 30 ~ 49	: 1500 ~ 1950	*/
	47,	47,	47,	47,	46,	46,	46,	45,	45,	44, 		/* 40 ~ 59	: 2000 ~ 2450	*/
	44,	43,	43,	42,	41,	40,	39,	38,	36,	35, 		/* 50 ~ 69	: 2500 ~ 2950	*/
	34,	32,	30,	29,	27,	25,	23,	22,	20,	18, 		/* 60 ~ 79	: 3000 ~ 3450	*/
	17,	15,	14,	13,	12,	12,	12,	12,	13,	15, 		/* 70 ~ 89	: 3500 ~ 3950	*/
	18,	21,								 			/* 80 ~ 81	: 4000 ~ 4050	*/
};

/**
* @fn UINT8 Sensor_SumpTemperature_GetValue(void)
* Sensor_SumpTemperature 평균값 Return 함수
* @param	없음
* @return	mucFinalSumpTempValue		SumpTemperature 평균값
* @see
*/
UINT8 Sensor_SumpTemperature_GetValue(void)
{
	return mucFinalSumpTempValue;
}

/**
* @fn void Sensor_SumpTemperature_SetValue(UINT8 ucValue)
* Sensor_SumpTemperature 평균값 설정 함수
* @param	ucValue		SumpTemperature 평균값
* @return	없음
* @see
*/
void Sensor_SumpTemperature_SetValue(UINT8 ucValue)
{
	if(mucMaxSumpTempValue < ucValue)
	{
		mucMaxSumpTempValue = ucValue;
	}
	else
	{
		;
	}

	mucFinalSumpTempValue = ucValue;
}

/**
* @fn void Sensor_SumpTemperature_Init(void)
* Sensor_SumpTemperature 초기화 함수
* @param	없음
* @return	없음
* @see
*/
void Sensor_SumpTemperature_Init(void)
{
	mucFinalSumpTempValue = CLEAR;
}

/**
* @fn UINT8 Sensor_SumpTemperature_GetSumpTemp(void)
* Sensor_SumpTemperature 변환값 Return 함수
* @param	없음
* @return	maucSumpTemperatureTable[mucFinalSumpTempValue]		SumpTemperature 변환값
* @see
*/
UINT8 Sensor_SumpTemperature_GetSumpTemp(void)
{
	return maucSumpTemperatureTable_Steam[mucFinalSumpTempValue];
}

/**
* @fn UINT8 Sensor_SumpTemperature_GetMaxSumpTemp(void)
* Sensor_SumpTemperature 변환값 Return 함수
* @param	없음
* @return	maucSumpTemperatureTable[mucMaxSumpTempValue]		Max SumpTemperature 변환값
* @see
*/
UINT8 Sensor_SumpTemperature_GetMaxSumpTemp(void)
{
	return maucSumpTemperatureTable_Steam[mucMaxSumpTempValue];
}

/**
* @fn UINT8 Sensor_SumpTemperature_GetAdcLimitValue(UINT16 unCurrentAdc)
* ADC값의 Min/Max Limit값 반환
* @param	unCurrentAdc	ADC값
* @return	Min/Max Limit값
* @see
*/
UINT8 Sensor_SumpTemperature_GetAdcLimitValue(UINT16 unCurrentAdc)
{
	UINT8 ucTableIndex = (UINT8)((unCurrentAdc & 0x0FFF) / SUMPTHERMISTOR_ADC_FILTER_SCALE);

	return maucSumpThermistor_Steam_AdcLimit[ucTableIndex];
}
