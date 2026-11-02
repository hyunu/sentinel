/*
 * TurbiditySensor.c
 *
 *  Created on: 2013. 7. 11.
 *      Author: youngho1.hwang
 */

/* --------------- Header 정의  ---------------  */
#include <string.h>
#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "./Timer.h"
#include "./Sensor_SumpTemperature.h"
#include "TurbiditySensor.h"


/* --------------- Define 정의  ---------------  */
#define TURBIDITYSENSOR_COMM_SEND_TIME_MSEC		(200)	// Data 송신 주기  - 200ms
#define TURBIDITYSENSOR_COMM_FAULT_TIME_SEC		(5)		// Data 수신 실패 시간(초)

#define	PACKET_BUFFER_SIZE					(44)
#define	PACKET_BYTE_START					(0xAA)
#define	PACKET_BYTE_END						(0x55)
#define	PACKET_SIZE_HEADER					(6)
#define	PACKET_SIZE_TRAILER					(3)
#define	PACKET_INDEX_LENGTH_H				(4)
#define	PACKET_INDEX_LENGTH_L				(5)
#define	PACKET_INDEX_ACK					(6)
#define	PACKET_INDEX_CMD					(7)
#define	PACKET_INDEX_BNO					(8)
#define	PACKET_INDEX_FW_VERSION_0			(9)
#define	PACKET_INDEX_FW_VERSION_1			(10)
#define	PACKET_INDEX_FW_VERSION_2			(11)
#define	PACKET_INDEX_TURB_VDD_ADC_H			(20)
#define	PACKET_INDEX_TURB_VDD_ADC_L			(21)
#define	PACKET_INDEX_TURB_A_H				(11)
#define	PACKET_INDEX_TURB_A_L				(12)
#define	PACKET_INDEX_TURB_B_H				(13)
#define	PACKET_INDEX_TURB_B_L				(14)
#define	PACKET_INDEX_TURB_C_H				(15)
#define	PACKET_INDEX_TURB_C_L				(16)

#define	CMD_GET_FW_VERSION					(0x30)
#define	CMD_MEASURE							(0x40)
#define	CMD_USER_MEMORY_READ				(0x60)
#define	CMD_USER_MEMORY_BNO_0x3C			(0x3C)
#define	CMD_ACK								(0x06)
#define	CMD_NACK							(0x15)

#define	TURBIDITYSENSOR_NTU_MAX				(5000)

#define	TURBIDITYVALUE_READ_COUNT			(30)	/* 탁도 센서 읽는 횟수 */
#define	TURBIDITYVALUE_AVG_COUNT			(6)		/* 탁도 평균 내기 위해 나누는 값 */
#define	TURBIDITYVALUE_READ_GAP				(1)		// 100ms (오염도 감지 이외 탁도 측정 시간 간격)
#define	TURBIDITYVALUE_READ_FIRST_GAP		(1)

#define	TURBIDITYVALUE_ARRAY_INDEX_12		(12)
#define	TURBIDITYVALUE_ARRAY_INDEX_13		(13)
#define	TURBIDITYVALUE_ARRAY_INDEX_14		(14)
#define	TURBIDITYVALUE_ARRAY_INDEX_15		(15)
#define	TURBIDITYVALUE_ARRAY_INDEX_16		(16)
#define	TURBIDITYVALUE_ARRAY_INDEX_17		(17)


/* --------------- Typedef형 정의  ---------------  */
typedef enum
{
	UART_RECV_STARTBYTE_CHECK = 0,
	UART_RECV_LENGTH_CHECK,
	UART_RECV_DATA_CHECK
} T_E_UART_RECV_STATE;

typedef enum
{
	TURBIDITYSENSOR_STATE_NONE = 0,
	TURBIDITYSENSOR_STATE_INIT,
	TURBIDITYSENSOR_STATE_OFF_DELAY,
	TURBIDITYSENSOR_STATE_ON_DELAY,
	TURBIDITYSENSOR_STATE_CHECK_VERSION,
	TURBIDITYSENSOR_STATE_READ_MEMORY,
	TURBIDITYSENSOR_STATE_REQUEST_SENSING,
	TURBIDITYSENSOR_STATE_OFF,
	TURBIDITYSENSOR_STATE_FAULT,
} T_E_TurbiditySensor_State;

typedef enum
{
	TURBIDITYVALUE_REQUEST_NONE = 0,
	TURBIDITYVALUE_REQUEST_START
} T_E_TurbidityValue_Requests;

typedef enum
{
	TURBIDITYVALUE_STATE_INIT = 0,
	TURBIDITYVALUE_STATE_CHECK,
	TURBIDITYVALUE_STATE_FINAL
} T_E_TurbidityValue_State;


/* --------------- 함수 원형 정의  ---------------  */
static void _TurbiditySensor_Uart_Initial(void);
static void _TurbiditySensor_Uart_Send_Data(UINT8 ucData);
static UINT8 _TurbiditySensor_Uart_Read_Data(void);
static void _TurbiditySensor_Uart_Clear_SR_Register(void);
static UINT16 _TurbiditySensor_Uart_CRCMaker(UINT8* pucBuffer, UINT8 ucLength);
static void _TurbiditySensor_Packet_GetFWVersion(void);
static void _TurbiditySensor_Packet_Measure(void);
static void _TurbiditySensor_Packet_UserMemoryRead(void);
static void _TurbiditySensor_Parsing_Packet(void);
static void _TurbiditySensor_RegularControl_Uart(void);

static void _TurbiditySensor_RegularControl_TurbidityValue(void);
static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize);


/* --------------- 전역 변수 정의  ---------------  */
static UINT8 mucUartSendIndex;
static UINT8 mucUartSendSize;
static UINT8 mucUartRecvIndex;
static UINT8 mucUartRecvCheckTimer;
static BOOL mbUartRecvEndFlag;
static T_E_UART_RECV_STATE meUarRecvState;
static UINT8 mucCommErrCheckTimer;
static UINT8 maucUartSendBuffer[PACKET_BUFFER_SIZE];
static UINT8 maucUartTempRecvBuffer[PACKET_BUFFER_SIZE];		/* 실제 UART 통신에 직접 액세스 되는 버퍼 */
static UINT8 maucUartRecvBuffer[PACKET_BUFFER_SIZE]; 			/* 수신받은 데이터가 저장되는 배열 */

static UINT8 mucSensor_FW_Version_0;
static UINT8 mucSensor_FW_Version_1;
static UINT8 mucSensor_FW_Version_2;
static UINT16 munSensor_Turb_a;
static UINT16 munSensor_Turb_b;
static UINT16 munSensor_Turb_c;
static UINT16 munSensor_ADC;
static UINT16 munTurbidity_NTU;
static T_E_TurbiditySensor_State meTurbiditySensorState;
static T_Time mstTimer_TurbiditySensor;

static T_E_TurbidityValue_State meTurbidityValueState;
static T_E_TurbidityValue_Requests meTurbidityValueRequest;
static UINT8 mucSensingCheck;
static UINT16 munTurbidityValue;

static T_Time mstTimer_Sensor_CheckCommunication;


/* --------------- 함수 정의  ---------------  */
/**
* @fn void TurbiditySensor_Init(void)
* 탁도센서 초기화 함수
* @param	없음
* @return	없음
* @see		최초 전원 On시에 드라이버 초기화 함수 호출
*/
void TurbiditySensor_Init (void)
{
	_TurbiditySensor_Uart_Initial();

	mucSensor_FW_Version_0 = 0;
	mucSensor_FW_Version_1 = 0;
	mucSensor_FW_Version_2 = 0;
	munSensor_Turb_a = 0;
	munSensor_Turb_b = 0;
	munSensor_Turb_c = 0;
	munSensor_ADC = 0;
	munTurbidity_NTU = 0;
	meTurbiditySensorState = TURBIDITYSENSOR_STATE_NONE;

	meTurbidityValueState = TURBIDITYVALUE_STATE_INIT;
	meTurbidityValueRequest = TURBIDITYVALUE_REQUEST_NONE;
	mucSensingCheck = TURBIDITYVALUE_READ_FIRST_GAP;
	munTurbidityValue = 0;
}

/**
* @fn void TurbiditySensor_TurnOn(void)
* 탁도센서 TR에 대한 On 요청
* @param	없음
* @return	없음
* @see		PowerRelay 포트 On
*/
void TurbiditySensor_TurnOn(void)
{
	meTurbiditySensorState = TURBIDITYSENSOR_STATE_INIT;
}

/**
* @fn void TurbiditySensor_TurnOff(void)
* 탁도센서 TR에 대한 Off 요청
* @param	없음
* @return	없음
* @see		PowerRelay 포트 On
*/
void TurbiditySensor_TurnOff(void)
{
	meTurbiditySensorState = TURBIDITYSENSOR_STATE_OFF;
}

/**
* @fn void TurbiditySensor_GetNTUValue(void)
* 탁도센서 NTU값 Return 함수
* @param	없음
* @return	UINT16		탁도센서 ADC값
* @see
*/
#ifndef __SILS__
UINT16 TurbiditySensor_GetNTUValue(void)
{
	return munTurbidity_NTU;
}
#endif

/**
* @fn void TurbiditySensor_RequestStartTurbidityValue(void)
* 탁도 감지 시작 요청 함수
* @param	없음
* @return	없음
* @see		탁도 감지 시작 요청 함수
*/
void TurbiditySensor_RequestStartTurbidityValue (void)
{
	meTurbidityValueRequest = TURBIDITYVALUE_REQUEST_START;
	meTurbidityValueState = TURBIDITYVALUE_STATE_INIT;
}

/**
* @fn void TurbiditySensor_IsCompleteTurbidityValue(void)
* 탁도 감지 완료 여부 확인 함수
* @param	없음
* @return	완료시 True, 미완료시 FALSE
* @see		탁도 감지 완료 여부 확인 함수
*/
BOOL TurbiditySensor_IsCompleteTurbidityValue(void)
{
	return (meTurbidityValueState == TURBIDITYVALUE_STATE_FINAL);
}

/**
* @fn UINT16 TurbiditySensor_GetTurbidityValue(void)
* 탁도센서 탁도 측정값 Return 함수
* @param	없음
* @return	UINT16		탁도 측정값
* @see
*/
UINT16 TurbiditySensor_GetTurbidityValue (void)
{
	return munTurbidityValue;
}

/**
* @fn BOOL TurbiditySensor_IsFault_Communication(void)
* 탁도센서 통신 Fault 확인.
* @param		 없음
* @return	BOOL	탁도센서 통신 Fault시 TRUE, 아니면 : FALSE.
* @see		없음.
*/
BOOL TurbiditySensor_IsFault_Communication(void)
{
	return (meTurbiditySensorState == TURBIDITYSENSOR_STATE_FAULT);
}

/**
* @fn void TurbiditySensor_RegularControl(void)
* 탁도센서 동작 함수
* @param	없음
* @return	없음
* @see		탁도센서 동작 함수
*/
void TurbiditySensor_RegularControl (void)
{
#ifndef __SILS__
	_TurbiditySensor_RegularControl_Uart();
#endif

	if(meTurbidityValueRequest == TURBIDITYVALUE_REQUEST_START)
	{
		_TurbiditySensor_RegularControl_TurbidityValue();
	}
	else
	{
		; ///do nothing
	}
}

/**
* @fn void TurbiditySensor_Isr_Timer_100ms_CheckTimer(void)
* 탁도센서 100ms 타이머 감지 인터럽트
* @param	없음
* @return	없음
* @see		탁도센서용 100ms 타이머 감지 인터럽트
*/
void TurbiditySensor_Isr_Timer_100ms_CheckTimer(void)
{
	if(mucSensingCheck > 0)
	{
		mucSensingCheck-- ;
	}
	else
	{
		; ///do nothing
	}
}

void TurbiditySensor_ISR_Send_Data(void)
{
	if(mucUartSendIndex >= mucUartSendSize)
	{
		mucUartSendIndex = 0;
	}
	else
	{
		_TurbiditySensor_Uart_Send_Data(maucUartSendBuffer[mucUartSendIndex]);
		mucUartSendIndex++;
	}
}

void TurbiditySensor_ISR_Receive_Data(void)
{
	UINT8 ucReadData = 0;
	UINT16 unCRC = 0;
	static UINT16 unRecvSize = 0;

	mucUartRecvCheckTimer = 0;

	switch(meUarRecvState)
	{
		case UART_RECV_STARTBYTE_CHECK:
			ucReadData = _TurbiditySensor_Uart_Read_Data();
			if(ucReadData == PACKET_BYTE_START)
			{
				mucUartRecvIndex = 0;
				maucUartTempRecvBuffer[mucUartRecvIndex] = ucReadData;
				mucUartRecvIndex++;
				meUarRecvState = UART_RECV_LENGTH_CHECK;
			}
			else
			{
				;
			}
		break;

		case UART_RECV_LENGTH_CHECK:
			maucUartTempRecvBuffer[mucUartRecvIndex] = _TurbiditySensor_Uart_Read_Data();
			mucUartRecvIndex++;
			if(mucUartRecvIndex == 6)
			{
				unRecvSize = (((UINT16)maucUartTempRecvBuffer[PACKET_INDEX_LENGTH_H] << 8) | (UINT16)maucUartTempRecvBuffer[PACKET_INDEX_LENGTH_L]) + PACKET_SIZE_HEADER + PACKET_SIZE_TRAILER;
				if(unRecvSize <= PACKET_BUFFER_SIZE)
				{
					meUarRecvState = UART_RECV_DATA_CHECK;
				}
				else
				{
					mucUartRecvIndex = 0;
					meUarRecvState = UART_RECV_STARTBYTE_CHECK;
				}
			}
			else
			{
				;
			}
		break;

		case UART_RECV_DATA_CHECK:
			maucUartTempRecvBuffer[mucUartRecvIndex] = _TurbiditySensor_Uart_Read_Data();
			mucUartRecvIndex++;
			if(mucUartRecvIndex >= unRecvSize)
			{
				if(mbUartRecvEndFlag == CLEAR)
				{
					/* CRC(16bit) 확인 */
					unCRC = (UINT16)maucUartTempRecvBuffer[unRecvSize - 3] << 8;
					unCRC |= maucUartTempRecvBuffer[unRecvSize - 2];

					if	(	(_TurbiditySensor_Uart_CRCMaker(maucUartTempRecvBuffer, unRecvSize - 3) == unCRC) &&
							(maucUartTempRecvBuffer[PACKET_INDEX_ACK] == CMD_ACK) &&				// ACK인 경우
							(maucUartTempRecvBuffer[unRecvSize - 1] == PACKET_BYTE_END)
						)
					{
						/* CRC 확인된 정상적인 패킷이면, */
						mbUartRecvEndFlag = SET;
						memcpy(maucUartRecvBuffer, maucUartTempRecvBuffer, unRecvSize);
					}
					else
					{
						;	/* CRC 오류가 발생한 경우, 수신데이터 무시함. */
					}
				}
				else
				{
					;
				}
				mucUartRecvIndex = 0;
				meUarRecvState = UART_RECV_STARTBYTE_CHECK;
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

void TurbiditySensor_ISR_Timer_10ms_CheckUart(void)
{
	if(meUarRecvState != UART_RECV_STARTBYTE_CHECK)
	{
		mucUartRecvCheckTimer++;
		if(mucUartRecvCheckTimer >= 5)						// 50ms
		{
			mucUartRecvCheckTimer = 0;
			mucUartRecvIndex = 0;
			meUarRecvState = UART_RECV_STARTBYTE_CHECK;

			_TurbiditySensor_Uart_Read_Data();				// Read Receive Comm Buffer
			_TurbiditySensor_Uart_Clear_SR_Register();		// Overrun Error Clear, Framing Error Clear, Parity Error Clear
		}
		else
		{
			;
		}
	}
	else
	{
		mucUartRecvCheckTimer = 0;

		mucCommErrCheckTimer++;
		if(mucCommErrCheckTimer >= 50)						// 500ms
		{
			mucCommErrCheckTimer = 0;
			if(EXTRACT_BITS(SCI0.SSR.BYTE, 3, 3))
			{
				_TurbiditySensor_Uart_Read_Data();				// Read Receive Comm Buffer
				_TurbiditySensor_Uart_Clear_SR_Register();		// Overrun Error Clear, Framing Error Clear, Parity Error Clear
			}
			else
			{
				;
			}
		}
		else
		{
			;
		}
	}
}


static void _TurbiditySensor_Uart_Initial(void)
{
	mucUartSendIndex = 0;
	mucUartSendSize = 0;

	mucUartRecvIndex = 0;
	mucUartRecvCheckTimer = 0;
	mbUartRecvEndFlag = CLEAR;
	meUarRecvState = UART_RECV_STARTBYTE_CHECK;
	mucCommErrCheckTimer = 0;

	memset(maucUartSendBuffer, 0, PACKET_BUFFER_SIZE);
	memset(maucUartTempRecvBuffer, 0, PACKET_BUFFER_SIZE);
	memset(maucUartRecvBuffer, 0, PACKET_BUFFER_SIZE);

	_TurbiditySensor_Uart_Read_Data();				// Read Receive Comm Buffer
	_TurbiditySensor_Uart_Clear_SR_Register();		// Overrun Error Clear, Framing Error Clear, Parity Error Clear
}

static void _TurbiditySensor_Uart_Send_Data(UINT8 ucData)
{
	SCI0.TDR = ucData;
}

static UINT8 _TurbiditySensor_Uart_Read_Data(void)
{
	return SCI0.RDR;
}

static void _TurbiditySensor_Uart_Clear_SR_Register(void)
{
	SCI0.SSR.BYTE = ((SCI0.SSR.BYTE & 0xC7) | 0xC0);	// Overrun Error Clear, Framing Error Clear, Parity Error Clear
}

static UINT16 _TurbiditySensor_Uart_CRCMaker(UINT8* pucBuffer, UINT8 ucLength)
{
	UINT8 uci;
	UINT16 unCrc = 0;
	UINT16 unTemp = 0;
	UINT16 unQuick = 0;

	for(uci = 0; uci < ucLength; uci++)
	{
		unTemp = (unCrc >> 8) ^ *pucBuffer++;
		unCrc <<= 8;
		unQuick = unTemp ^ (unTemp >> 4);
		unCrc ^= unQuick;
		unQuick <<= 5;
		unCrc ^= unQuick;
		unQuick <<= 7;
		unCrc ^= unQuick;
	}

	return unCrc;
}

static void _TurbiditySensor_Packet_GetFWVersion(void)
{
	UINT16 unSendCrc = 0x00;

	mucUartSendSize = 0;

	// Header
	maucUartSendBuffer[mucUartSendSize++] = PACKET_BYTE_START;
	maucUartSendBuffer[mucUartSendSize++] = 'W';
	maucUartSendBuffer[mucUartSendSize++] = '-';
	maucUartSendBuffer[mucUartSendSize++] = 'S';
	maucUartSendBuffer[mucUartSendSize++] = 0x00;
	maucUartSendBuffer[mucUartSendSize++] = 0x08;

	// Payload
	maucUartSendBuffer[mucUartSendSize++] = 0x00;					// ACK/NACK : NONE
	maucUartSendBuffer[mucUartSendSize++] = CMD_GET_FW_VERSION;		// CMD ID
	maucUartSendBuffer[mucUartSendSize++] = 0x00;					// bNo
	maucUartSendBuffer[mucUartSendSize++] = 0x00;					// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;					// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;					// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;					// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;					// RFU

	// Trailer
	unSendCrc = _TurbiditySensor_Uart_CRCMaker(maucUartSendBuffer, mucUartSendSize);
	maucUartSendBuffer[mucUartSendSize++] = HIBYTE(unSendCrc);
	maucUartSendBuffer[mucUartSendSize++] = LOBYTE(unSendCrc);
	maucUartSendBuffer[mucUartSendSize++] = PACKET_BYTE_END;
}

static void _TurbiditySensor_Packet_Measure(void)
{
	UINT16 unSendCrc = 0x00;

	mucUartSendSize = 0;

	// Header
	maucUartSendBuffer[mucUartSendSize++] = PACKET_BYTE_START;
	maucUartSendBuffer[mucUartSendSize++] = 'W';
	maucUartSendBuffer[mucUartSendSize++] = '-';
	maucUartSendBuffer[mucUartSendSize++] = 'S';
	maucUartSendBuffer[mucUartSendSize++] = 0x00;
	maucUartSendBuffer[mucUartSendSize++] = 0x08;

	// Payload
	maucUartSendBuffer[mucUartSendSize++] = 0x00;			// ACK/NACK : NONE
	maucUartSendBuffer[mucUartSendSize++] = CMD_MEASURE;	// CMD ID
	maucUartSendBuffer[mucUartSendSize++] = 0x00;			// bNo
	maucUartSendBuffer[mucUartSendSize++] = 0x00;			// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;			// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;			// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;			// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;			// RFU

	// Trailer
	unSendCrc = _TurbiditySensor_Uart_CRCMaker(maucUartSendBuffer, mucUartSendSize);
	maucUartSendBuffer[mucUartSendSize++] = HIBYTE(unSendCrc);
	maucUartSendBuffer[mucUartSendSize++] = LOBYTE(unSendCrc);
	maucUartSendBuffer[mucUartSendSize++] = PACKET_BYTE_END;
}

static void _TurbiditySensor_Packet_UserMemoryRead(void)
{
	UINT16 unSendCrc = 0x00;

	mucUartSendSize = 0;

	// Header
	maucUartSendBuffer[mucUartSendSize++] = PACKET_BYTE_START;
	maucUartSendBuffer[mucUartSendSize++] = 'W';
	maucUartSendBuffer[mucUartSendSize++] = '-';
	maucUartSendBuffer[mucUartSendSize++] = 'S';
	maucUartSendBuffer[mucUartSendSize++] = 0x00;
	maucUartSendBuffer[mucUartSendSize++] = 0x8;

	// Payload
	maucUartSendBuffer[mucUartSendSize++] = 0x00;						// ACK/NACK : NONE
	maucUartSendBuffer[mucUartSendSize++] = CMD_USER_MEMORY_READ;		// CMD ID
	maucUartSendBuffer[mucUartSendSize++] = CMD_USER_MEMORY_BNO_0x3C;	// bNo : 0x3C
	maucUartSendBuffer[mucUartSendSize++] = 0x00;						// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;						// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;						// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;						// RFU
	maucUartSendBuffer[mucUartSendSize++] = 0x00;						// RFU

	// Trailer
	unSendCrc = _TurbiditySensor_Uart_CRCMaker(maucUartSendBuffer, mucUartSendSize);
	maucUartSendBuffer[mucUartSendSize++] = HIBYTE(unSendCrc);
	maucUartSendBuffer[mucUartSendSize++] = LOBYTE(unSendCrc);
	maucUartSendBuffer[mucUartSendSize++] = PACKET_BYTE_END;
}

static void _TurbiditySensor_Parsing_Packet(void)
{
	static double dSumpTemperature = 0.0;
	static double dCal_Adc = 0.0;
	static INT32 lCal_NTU = 0;

	switch(maucUartRecvBuffer[PACKET_INDEX_CMD])
	{
		case CMD_GET_FW_VERSION:
			mucSensor_FW_Version_0 = maucUartRecvBuffer[PACKET_INDEX_FW_VERSION_0];
			mucSensor_FW_Version_1 = maucUartRecvBuffer[PACKET_INDEX_FW_VERSION_1];
			mucSensor_FW_Version_2 = maucUartRecvBuffer[PACKET_INDEX_FW_VERSION_2];
		break;

		case CMD_MEASURE:
			munSensor_ADC = (double)(((UINT16)maucUartRecvBuffer[PACKET_INDEX_TURB_VDD_ADC_H] << 8) | (UINT16)maucUartRecvBuffer[PACKET_INDEX_TURB_VDD_ADC_L]);
			dSumpTemperature = (double)Sensor_SumpTemperature_GetSumpTemp();
			dCal_Adc = (double)munSensor_ADC * ( 0.000059 * (dSumpTemperature * dSumpTemperature) + 0.002198 * dSumpTemperature + 0.932786);
			lCal_NTU = (INT32)(((dCal_Adc * dCal_Adc) * (double)munSensor_Turb_a) * 0.000001 - (dCal_Adc * (double)munSensor_Turb_b) * 0.001 + (double)munSensor_Turb_c);
			if(lCal_NTU < 0)
			{
				munTurbidity_NTU = 0;
			}
			else if(lCal_NTU > TURBIDITYSENSOR_NTU_MAX)
			{
				munTurbidity_NTU = TURBIDITYSENSOR_NTU_MAX;
			}
			else
			{
				munTurbidity_NTU = (UINT16)lCal_NTU;
			}
		break;

		case CMD_USER_MEMORY_READ:
			munSensor_Turb_a = ((UINT16)maucUartRecvBuffer[PACKET_INDEX_TURB_A_H] << 8) | (UINT16)maucUartRecvBuffer[PACKET_INDEX_TURB_A_L];
			munSensor_Turb_b = ((UINT16)maucUartRecvBuffer[PACKET_INDEX_TURB_B_H] << 8) | (UINT16)maucUartRecvBuffer[PACKET_INDEX_TURB_B_L];
			munSensor_Turb_c = ((UINT16)maucUartRecvBuffer[PACKET_INDEX_TURB_C_H] << 8) | (UINT16)maucUartRecvBuffer[PACKET_INDEX_TURB_C_L];
		break;

		default:
		break;
	}
}


static void _TurbiditySensor_RegularControl_Uart(void)
{
	if(mbUartRecvEndFlag == SET)
	{
		mbUartRecvEndFlag = CLEAR;
		_TurbiditySensor_Parsing_Packet();
		Timer_GetTime(&mstTimer_Sensor_CheckCommunication);
	}
	else
	{
		;
	}

	switch(meTurbiditySensorState)
	{
		case TURBIDITYSENSOR_STATE_NONE:
		break;

		case TURBIDITYSENSOR_STATE_INIT:
			TURBIDITYTR_PORT = OFF;
			Timer_GetTime(&mstTimer_TurbiditySensor);
			meTurbiditySensorState = TURBIDITYSENSOR_STATE_OFF_DELAY;
		break;

		case TURBIDITYSENSOR_STATE_OFF_DELAY:
			if(Timer_SecCheckPassTime(&mstTimer_TurbiditySensor, TIME_1SEC, UPDATE) == TRUE)
			{
				TURBIDITYTR_PORT = ON;
				meTurbiditySensorState = TURBIDITYSENSOR_STATE_ON_DELAY;
			}
			else
			{
				;
			}
		break;

		case TURBIDITYSENSOR_STATE_ON_DELAY:
			if(Timer_SecCheckPassTime(&mstTimer_TurbiditySensor, TIME_1SEC, UPDATE) == TRUE)
			{
				mucSensor_FW_Version_0 = 0;
				mucSensor_FW_Version_1 = 0;
				mucSensor_FW_Version_2 = 0;
				munSensor_Turb_a = 0;
				munSensor_Turb_b = 0;
				munSensor_Turb_c = 0;
				Timer_GetTime(&mstTimer_Sensor_CheckCommunication);
				memset(maucUartSendBuffer, 0, PACKET_BUFFER_SIZE);
				memset(maucUartTempRecvBuffer, 0, PACKET_BUFFER_SIZE);
				_TurbiditySensor_Packet_GetFWVersion();
				mucUartSendIndex = 1;
				_TurbiditySensor_Uart_Send_Data(maucUartSendBuffer[0]);
				meTurbiditySensorState = TURBIDITYSENSOR_STATE_CHECK_VERSION;
			}
			else
			{
				;
			}
		break;

		case TURBIDITYSENSOR_STATE_CHECK_VERSION:
			if(Timer_MsecCheckPassTime(&mstTimer_TurbiditySensor, TURBIDITYSENSOR_COMM_SEND_TIME_MSEC, UPDATE) == TRUE)
			{
				memset(maucUartSendBuffer, 0, PACKET_BUFFER_SIZE);
				memset(maucUartTempRecvBuffer, 0, PACKET_BUFFER_SIZE);
				if((mucSensor_FW_Version_0 != 0) && (mucSensor_FW_Version_1 != 0) && (mucSensor_FW_Version_2 != 0))
				{
					_TurbiditySensor_Packet_UserMemoryRead();
					meTurbiditySensorState = TURBIDITYSENSOR_STATE_READ_MEMORY;
				}
				else
				{
					_TurbiditySensor_Packet_GetFWVersion();
				}
				mucUartSendIndex = 1;
				_TurbiditySensor_Uart_Send_Data(maucUartSendBuffer[0]);
			}
			else
			{
				;
			}

			if(Timer_SecCheckPassTime(&mstTimer_Sensor_CheckCommunication, TURBIDITYSENSOR_COMM_FAULT_TIME_SEC, NONE) == TRUE)
			{
				meTurbiditySensorState = TURBIDITYSENSOR_STATE_FAULT;
			}
			else
			{
				;
			}
		break;

		case TURBIDITYSENSOR_STATE_READ_MEMORY:
			if(Timer_MsecCheckPassTime(&mstTimer_TurbiditySensor, TURBIDITYSENSOR_COMM_SEND_TIME_MSEC, UPDATE) == TRUE)
			{
				memset(maucUartSendBuffer, 0, PACKET_BUFFER_SIZE);
				memset(maucUartTempRecvBuffer, 0, PACKET_BUFFER_SIZE);
				if((munSensor_Turb_a != 0) && (munSensor_Turb_b != 0) && (munSensor_Turb_c != 0))
				{
					_TurbiditySensor_Packet_Measure();
					meTurbiditySensorState = TURBIDITYSENSOR_STATE_REQUEST_SENSING;
				}
				else
				{
					_TurbiditySensor_Packet_UserMemoryRead();
				}
				mucUartSendIndex = 1;
				_TurbiditySensor_Uart_Send_Data(maucUartSendBuffer[0]);
			}
			else
			{
				;
			}

			if(Timer_SecCheckPassTime(&mstTimer_Sensor_CheckCommunication, TURBIDITYSENSOR_COMM_FAULT_TIME_SEC, NONE) == TRUE)
			{
				meTurbiditySensorState = TURBIDITYSENSOR_STATE_FAULT;
			}
			else
			{
				;
			}
		break;

		case TURBIDITYSENSOR_STATE_REQUEST_SENSING:
			if(Timer_MsecCheckPassTime(&mstTimer_TurbiditySensor, TURBIDITYSENSOR_COMM_SEND_TIME_MSEC, UPDATE) == TRUE)
			{
				memset(maucUartSendBuffer, 0, PACKET_BUFFER_SIZE);
				memset(maucUartTempRecvBuffer, 0, PACKET_BUFFER_SIZE);
				_TurbiditySensor_Packet_Measure();
				mucUartSendIndex = 1;
				_TurbiditySensor_Uart_Send_Data(maucUartSendBuffer[0]);
			}
			else
			{
				;
			}

			if(Timer_SecCheckPassTime(&mstTimer_Sensor_CheckCommunication, TURBIDITYSENSOR_COMM_FAULT_TIME_SEC, NONE) == TRUE)
			{
				meTurbiditySensorState = TURBIDITYSENSOR_STATE_FAULT;
			}
			else
			{
				;
			}
		break;

		case TURBIDITYSENSOR_STATE_OFF:
		case TURBIDITYSENSOR_STATE_FAULT:
			munTurbidity_NTU = 0;
		break;

		default:
		break;
	}
}


/**
* @fn static void _TurbiditySensor_RegularControl_TurbidityValue(void)
* 탁도값 측정 함수
* @param	없음
* @return	없음
* @see
*/
static void _TurbiditySensor_RegularControl_TurbidityValue(void)
{
	static UINT8 ucReadCount = 0;
	static UINT32 aulReadValue[TURBIDITYVALUE_READ_COUNT] = {0, };
	UINT32 ulTempSum = 0;
	UINT32* pulSortingData = NULL;

	switch(meTurbidityValueState)
	{
		case TURBIDITYVALUE_STATE_INIT:
			munTurbidityValue = 0;
			ucReadCount = 0;
			mucSensingCheck = TURBIDITYVALUE_READ_FIRST_GAP;
			meTurbidityValueState = TURBIDITYVALUE_STATE_CHECK;
		break;

		case TURBIDITYVALUE_STATE_CHECK:
			if(mucSensingCheck <= 0)
			{
				mucSensingCheck = TURBIDITYVALUE_READ_GAP;		/* 탁도 센서를 100ms 간격으로 30번 읽음 */
				aulReadValue[ucReadCount] = (UINT32)munTurbidity_NTU;
#ifdef __SILS__
				aulReadValue[ucReadCount] = (UINT32)TurbiditySensor_GetNTUValue();
#endif
				ucReadCount++;
				if (ucReadCount >= TURBIDITYVALUE_READ_COUNT)	/* 30회를 읽었을 경우 다음 스텝으로 넘어간다 */
				{
					/* 상 하한 12개를 버리고 가운데 6개의 값의 평균을 구함 */
					pulSortingData = _Get_BubbleSortingData(aulReadValue, TURBIDITYVALUE_READ_COUNT);
					ulTempSum = pulSortingData[TURBIDITYVALUE_ARRAY_INDEX_12] + pulSortingData[TURBIDITYVALUE_ARRAY_INDEX_13] + pulSortingData[TURBIDITYVALUE_ARRAY_INDEX_14] +
								pulSortingData[TURBIDITYVALUE_ARRAY_INDEX_15] + pulSortingData[TURBIDITYVALUE_ARRAY_INDEX_16] + pulSortingData[TURBIDITYVALUE_ARRAY_INDEX_17];
					munTurbidityValue = (UINT16)(ulTempSum / TURBIDITYVALUE_AVG_COUNT);
					meTurbidityValueState = TURBIDITYVALUE_STATE_FINAL;
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

		case TURBIDITYVALUE_STATE_FINAL :
			meTurbidityValueRequest = TURBIDITYVALUE_REQUEST_NONE; // 탁도감지 완료 후, 요청Flag clear
		break;

		default:
		break;
	}
}

/**
* @fn static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize)
* 탁도 측정 내에서 사용하는 탁도 Data 정렬
* @param	pulSortingSource 	정렬할 원본 데이터
* @param	unSize 				정렬할 데이터 크기
* @return	정렬된 데이터
* @see					버블 정렬
*/
static UINT32* _Get_BubbleSortingData(UINT32* pulSortingSource, UINT16 unSize)
{
	UINT16 uni = 0, unj = 0;
	UINT32 ulTemp = 0;

	for(uni = 0 ; uni < unSize ; uni++)
	{
		for(unj = uni + 1; unj < unSize ; unj++)
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
