/*
 * Uart.c
 *
 *  Created on: 2013. 8. 28.
 *      Author: seongju.lim
 */

/* --------------- Header 정의  ---------------  */
#include <string.h>
#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "Uart.h"
#include "Uart_RingBuffer.h"


/* --------------- Define 정의  ---------------  */
// Receive State
#define	UART_NON_RECEIVE			(0)
#define	UART_RECEIVING				(1)


/* --------------- Typedef형 정의  ---------------  */
typedef enum
{
	UART_ISR_STEP_WAIT_STX = 0,
	UART_ISR_STEP_RECEIVING_LENGTH,
	UART_ISR_STEP_RECEIVING_DATA,
	UART_ISR_STEP_MAX
} UART_ISR_STEP;

/* --------------- 함수 원형 정의  ---------------  */
static void _Uart_Init(void);
static void _Uart_Clear_SR_Register(void);
static void _Uart_Send_Data(UINT8 ucData);
static UINT8 _Uart_Read_Data(void);
static BOOL _Check_RecvCommData(void);


/* --------------- 전역 변수 정의  ---------------  */
static UINT8 maucUartSendBuffer[UARTTX_MAX];	/* 보낼 데이터가 저장되는 배열로 실제 UART 통신에 직접 액세스 되는 버퍼 */
static UINT8 maucUartRecvBuffer[UARTRX_MAX]; 	/* 수신받은 데이터가 저장되는 배열 */
#ifndef __SILS__
static UINT8 maucTempRecvBuffer[UARTRX_MAX];	/* 실제 UART 통신에 직접 액세스 되는 버퍼 */
#else
UINT8 maucTempRecvBuffer[UARTRX_MAX];	/* 실제 UART 통신에 직접 액세스 되는 버퍼 */
UINT8 maucTempSendBuffer[UARTTX_MAX];
#endif
static UINT8 mucCommErrCheckTimer;
static UINT16 munReceiveIndex;					/* 현재 수신  중인 Data Buffer의 Index */
static UINT8 mucReceiveCheckTimer;
static UINT8 mucReceiveMode;
static BOOL mbReceiveEndFlag;					/* Display에서 데이터 수신 완료 체크 Flag */
static UINT16 munReceiveLength;					/* 수신받은 데이터의 Length */
static UINT8 mucISRReceiveStep;					/* 수신받은 데이터 처리 Step */


/* --------------- 함수 정의  ---------------  */
/**
* @fn static UINT8 _Uart_Read_Data(void)
* 수신 버퍼에서 Read하는 함수
* @param	없음
* @return	Display에서 보낸 data
* @see
*/
static UINT8 _Uart_Read_Data(void)
{
	return SCI1.RDR;
}

/**
* @fn static void _Uart_Init(void)
* 수신 통신 버퍼를 Clear하는 함수
* @param	없음
* @return	없음
* @see
*/
static void _Uart_Init(void)
{
	SCI1.RDR = 0x00;
}

/**
* @fn static void _Uart_Send_Data(UINT8 ucData)
* Display 로 data 를 보내는 함수
* @param	ucData	Display 로 보내는 data
* @return	없음
* @see
*/
static void _Uart_Send_Data(UINT8 ucData)
{
	SCI1.TDR = ucData;
}

/**
* @fn static void _Uart_Clear_SR_Register(void)
* SR_Register 를 Clear 하는 함수
* @param	없음
* @return	없음
* @see		없음
*/
static void _Uart_Clear_SR_Register(void)
{
	SCI1.SSR.BYTE = ((SCI1.SSR.BYTE & 0xC7) | 0xC0);	// Overrun Error Clear, Framing Error Clear, Parity Error Clear
}

/**
* @fn static BOOL _Check_RecvCommData(void)
* 수신 Data의 무결성을 체크
* @param	없음
* @return	무결하면 TRUE, 아니면 FALSE
* @see		없음
*/
static BOOL _Check_RecvCommData(void)
{
	BOOL bReturn = FALSE;
	UINT16 unTempCrc = 0x00;

	if((munReceiveLength >= UARTRX_MIN) && (munReceiveLength <= UARTRX_MAX))
	{
		unTempCrc = CRCMaker(maucTempRecvBuffer, (UINT16)(munReceiveLength - 3));	// CRC16 계산 (CRC16이 포함된 Packet Length - CRC16(2) - ETX(1))

		if	(	(maucTempRecvBuffer[UARTRX_STX] == UART_PACKET_STX) &&
				(maucTempRecvBuffer[munReceiveLength - 1] == UART_PACKET_ETX) &&
				(maucTempRecvBuffer[munReceiveLength - 3] == HIBYTE(unTempCrc)) &&
				(maucTempRecvBuffer[munReceiveLength - 2] == LOBYTE(unTempCrc))
			)
		{
			bReturn = TRUE;
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
	return bReturn;
}

// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
// Interface Function Implementation
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$

/**
* @fn BOOL Uart_Initial(void)
* Uart 통신 초기화
* @param	없음
* @return	없음
* @see		없음
*/
void Uart_Initial(void)
{
	memset(maucUartSendBuffer, 0, UARTTX_MAX);
	memset(maucUartRecvBuffer, 0, UARTRX_MAX);
	memset(maucTempRecvBuffer, 0, UARTRX_MAX);

	munReceiveIndex = 0;
	munReceiveLength = 0;

	mucReceiveCheckTimer = 0;
	mucReceiveMode = UART_NON_RECEIVE;
	mbReceiveEndFlag = CLEAR;
	mucCommErrCheckTimer = 0;
	mucISRReceiveStep = UART_ISR_STEP_WAIT_STX;

	_Uart_Init();							/* Uart 수신 데이터 초기화 */
	UartRingTx_Init();
}

/**
* @fn UINT16 CRCMaker(const UINT8* pucBuffer, UINT16 unLength)
* 송 수신 Data의 CRC16 값을 계산한다.
* @param		*pucBuffer	CRC16을 계산할 Data의 포인터
* @param		unLength	Data의 Size
* @return	unCrc		CRC 값
* @see		없음
*/
UINT16 CRCMaker(const UINT8* pucBuffer, UINT16 unLength)
{
	UINT16 uni;
	UINT16 unCrc = 0;
	UINT16 unTemp = 0;
	UINT16 unQuick = 0;

	for(uni = 0; uni < unLength; uni++)
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

/**
* @fn UINT8 Uart_Get_RecvBuffer(T_E_UartRxName eRxName)
* 수신 Data에서 원하는 Index의 데이터를 얻어옴
* @param		eRxName		얻고자 하는 Rx data name
* @return	정상 처리되면 TRUE, 아니면 FALSE
* @see		없음
*/
UINT8 Uart_Get_RecvBuffer(T_E_UartRxName eRxName)
{
	UINT8 ucReturn = 0;

	if (eRxName < UARTRX_MAX)
	{
		ucReturn = maucUartRecvBuffer[eRxName];
	}
	else
	{
		;	///< Do nothing
	}

	return ucReturn;
}

/**
* @fn void Uart_SendManager(UINT8* pucSendBuffer)
* Uart Send Manager, Regular Control 에서 호출한다.
* @param	pucSendBuffer		송신하는 buffer
* @return	없음
* @see		없음
*/
void Uart_SendManager(UINT8* pucSendBuffer)
{
	UINT16 unSendCrc = 0;

	memcpy(maucUartSendBuffer, pucSendBuffer, UARTTX_MAX);

	/* CRC 계산 */
	unSendCrc = CRCMaker(maucUartSendBuffer, (UINT16)UARTTX_CRC_H);
	maucUartSendBuffer[UARTTX_CRC_H] = HIBYTE(unSendCrc);
	maucUartSendBuffer[UARTTX_CRC_L] = LOBYTE(unSendCrc);

	/* Ring Buffer 인큐 */
	UartRingTx_EnqueueMonitoringPacket(maucUartSendBuffer, UARTTX_MAX);
#ifdef __SILS__
	memcpy(maucTempSendBuffer, maucUartSendBuffer, UARTTX_MAX);
#endif
}

/**
* @fn BOOL Uart_ReceiveManager(void)
* Uart Receive Manager, Regular Control 에서 호출한다.
* @param	없음
* @return	성공여부(CRC 통과시 1, CRC 실패시 0)
* @see		없음
*/
BOOL Uart_ReceiveManager(void)
{
	BOOL bReturn = FALSE;

	if (_Check_RecvCommData() == TRUE)
	{
		memset(maucUartRecvBuffer, 0, UARTRX_MAX);
		memcpy(maucUartRecvBuffer, maucTempRecvBuffer, munReceiveLength);
		bReturn = TRUE;
	}
	else
	{
		;
	}	
	munReceiveLength = 0;		// CRC 통과 여부와 상관없이 수신 Length 초기화

	return bReturn;
}

/**
* @fn void Uart_SetSendTimer(void)
* Uart 통신 주기 설정하는 함수
* @param	없음
* @return	없음
* @see		없음
*/
void Uart_ClearReceiveEndFlg(void)
{
	mbReceiveEndFlag = CLEAR;
}

#ifdef __SILS__
void Uart_SetReceiveEndFlg(void)
{
	mbReceiveEndFlag = SET;
}
#endif

/**
* @fn BOOL Uart_GetReceiveEndFlg(void)
* Uart 수신 완료 Flag를 Return 하는 함수
* @param	없음
* @return	mbReceiveEndFlag		Uart 수신 완료 Flag
* @see		없음
*/
BOOL Uart_GetReceiveEndFlg(void)
{
	return mbReceiveEndFlag;
}

/**
* @fn void Uart_ISR_10ms_Timer(void)
* Uart Timer 구동 함수, 10ms Interrupt에서 호출
* @param	없음
* @return	없음
* @see		없음
*/
void Uart_ISR_Timer_10ms(void)
{
	if (mucReceiveMode == UART_RECEIVING)
	{
		mucReceiveCheckTimer++;
		if (mucReceiveCheckTimer >= 5)		// 50ms
		{
			mucReceiveCheckTimer = 0;
			munReceiveIndex = 0;
			munReceiveLength = 0;
			mucReceiveMode = UART_NON_RECEIVE;
			mucCommErrCheckTimer = 0;
			mucISRReceiveStep = UART_ISR_STEP_WAIT_STX;

			_Uart_Read_Data();				// Read Receive Comm Buffer
			_Uart_Clear_SR_Register();		// Overrun Error Clear, Framing Error Clear, Parity Error Clear
		}
		else
		{
			;
		}
	}
	else
	{
		mucReceiveCheckTimer = 0;

		mucCommErrCheckTimer++;
		if(mucCommErrCheckTimer >= 30)		// 300ms
		{
			mucCommErrCheckTimer = 0;
			if(EXTRACT_BITS(SCI1.SSR.BYTE, 3, 3))
			{
				_Uart_Read_Data();				// Read Receive Comm Buffer
				_Uart_Clear_SR_Register();		// Overrun Error Clear, Framing Error Clear, Parity Error Clear
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

/**
* @fn void Uart_ISR_Sending_CommData(void)
* Uart Interrupt에서 Data를 송신하는 루틴
* @param	없음
* @return	없음
* @see		없음
*/
void Uart_ISR_Sending_CommData(void)
{
	UartRingTx_OnTxInterrupt();
}

/**
* @fn void Uart_PortSendByte(UINT8 ucData)
* UART 포트로 1바이트를 전송한다.
* @param	ucData	전송 데이터 1바이트
* @return	없음
* @see		없음
*/
void Uart_PortSendByte(UINT8 ucData)
{
	_Uart_Send_Data(ucData);
}

/**
* @fn void Uart_ISR_Recving_CommData(void)
* Uart Interrupt에서 Data를 수신하는 루틴
* @param	없음
* @return	없음
* @see		없음
*/
void Uart_ISR_Recving_CommData(void)
{
	UINT8 ucReceiveData = _Uart_Read_Data();

	if(mbReceiveEndFlag == CLEAR)
	{
		mucReceiveCheckTimer = 0;
		switch(mucISRReceiveStep)
		{
			case UART_ISR_STEP_WAIT_STX:
				if(ucReceiveData == UART_PACKET_STX)
				{
					mucISRReceiveStep = UART_ISR_STEP_RECEIVING_LENGTH;
					mucReceiveMode = UART_RECEIVING;
					maucTempRecvBuffer[munReceiveIndex++] = ucReceiveData;
				}
				else
				{
					munReceiveIndex = 0;
					mucReceiveMode = UART_NON_RECEIVE;
				}
			break;

			case UART_ISR_STEP_RECEIVING_LENGTH:
				maucTempRecvBuffer[munReceiveIndex] = ucReceiveData;
				if(munReceiveIndex >= UARTRX_PACKET_LENGTH_L)
				{	// Length 정보 수신 완료
					munReceiveLength = maucTempRecvBuffer[UARTRX_PACKET_LENGTH_H] << 8 | maucTempRecvBuffer[UARTRX_PACKET_LENGTH_L];
					if((munReceiveLength < UARTRX_MIN) || (munReceiveLength > UARTRX_MAX))
					{
						munReceiveIndex = 0;
						munReceiveLength = 0;
						mucISRReceiveStep = UART_ISR_STEP_WAIT_STX;
						mucReceiveMode = UART_NON_RECEIVE;
					}
					else
					{
						munReceiveIndex++;
						mucISRReceiveStep = UART_ISR_STEP_RECEIVING_DATA;
					}
				}
				else
				{
					munReceiveIndex++;
				}
			break;

			case UART_ISR_STEP_RECEIVING_DATA:
				maucTempRecvBuffer[munReceiveIndex++] = ucReceiveData;

				if((munReceiveLength != 0) && (munReceiveIndex >= munReceiveLength))
				{
					mucISRReceiveStep = UART_ISR_STEP_WAIT_STX;
					mucReceiveMode = UART_NON_RECEIVE;
					munReceiveIndex = 0;
					mbReceiveEndFlag = SET;
					mucCommErrCheckTimer = 0;
				}
				else
				{
					;
				}
			break;

			default:
				mucISRReceiveStep = UART_ISR_STEP_WAIT_STX;
				mucReceiveMode = UART_NON_RECEIVE;
				munReceiveIndex = 0;
			break;
		}
	}
	else
	{
		mucISRReceiveStep = UART_ISR_STEP_WAIT_STX;
		mucReceiveMode = UART_NON_RECEIVE;
		munReceiveIndex = 0;
	}
}