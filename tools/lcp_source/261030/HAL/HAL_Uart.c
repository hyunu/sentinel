/*
 * HAL_Uart.c
 *
 *  Created on: 2013. 8. 29.
 *      Author: seongju.lim
 */

#include "../Common/Type.h"
#include "../Driver/Uart.h"
#include "../Driver/Uart_RingBuffer.h"

/**
* @fn void HAL_Uart_ISR_Timer_10ms(void)
* Uart Timer 구동 함수, 10ms Interrupt에서 호출
* @param	없음
* @return	없음
* @see		없음
*/
void HAL_Uart_ISR_Timer_10ms(void)
{
	Uart_ISR_Timer_10ms();
}

/**
* @fn void HAL_Uart_ClearReceiveEndFlg(void)
* Uart 수신 완료 Flag를 해제하는 함수
* @param	없음
* @return	없음
* @see		없음
*/
void HAL_Uart_ClearReceiveEndFlg(void)
{
	Uart_ClearReceiveEndFlg();
}

/**
* @fn BOOL HAL_Uart_GetReceiveEndFlg(void)
* Uart 수신 완료 Flag를 Return 하는 함수
* @param	없음
* @return	mbReceiveEndFlag		Uart 수신 완료 Flag
* @see		없음
*/
BOOL HAL_Uart_GetReceiveEndFlg(void)
{
	return Uart_GetReceiveEndFlg();
}

/**
* @fn UINT8 HAL_Uart_Get_RecvBuffer(UINT16 eRxIndex)
* 수신 Data에서 원하는 Index의 데이터를 얻어옴
* @param		eRxIndex		얻고자 하는 Rx data index
* @return	정상 처리되면 TRUE, 아니면 FALSE
* @see		없음
*/
UINT8 HAL_Uart_Get_RecvBuffer(UINT16 eRxIndex)
{
	return Uart_Get_RecvBuffer((T_E_UartRxName)eRxIndex);
}

/**
* @fn void HAL_Uart_Initial(void)
* Uart 통신 초기화
* @param	없음
* @return	없음
* @see		없음
*/
void HAL_Uart_Initial(void)
{
	Uart_Initial();
}

/**
* @fn void HAL_Uart_ISR_Sending_CommData(void)
* Uart Interrupt에서 Data를 송신하는 루틴
* @param	없음
* @return	없음
* @see		없음
*/
void HAL_Uart_ISR_Sending_CommData(void)
{
	Uart_ISR_Sending_CommData();
}

/**
* @fn void HAL_Uart_ISR_Recving_CommData(void)
* Uart Interrupt에서 Data를 수신하는 루틴
* @param	없음
* @return	없음
* @see		없음
*/
void HAL_Uart_ISR_Recving_CommData(void)
{
	Uart_ISR_Recving_CommData();
}

/**
* @fn void HAL_Uart_SendManager(UINT8* pucSendBuffer)
* Uart Send Manager, Regular Control 에서 호출한다.
* @param	pucSendBuffer		송신하는 buffer
* @return	없음
* @see		없음
*/
void HAL_Uart_SendManager(UINT8* pucSendBuffer)
{
	Uart_SendManager(pucSendBuffer);
}

/**
* @fn BOOL HAL_Uart_ReceiveManager(void)
* Uart Receive Manager, Regular Control 에서 호출한다.
* @param	없음
* @return	성공여부(CRC 통과시 1, CRC 실패시 0)
* @see		없음
*/
BOOL HAL_Uart_ReceiveManager(void)
{
	return Uart_ReceiveManager();
}

BOOL HAL_Uart_AckBuildBegin(UINT16 unReqSeqNo, UINT8 ucAttr)
{
	return UartRingTx_AckBuildBegin(unReqSeqNo, ucAttr);
}

BOOL HAL_Uart_AckBuildAddFuncResult(UINT8 ucFlag, UINT8 ucFuncId, const UINT8 *pucResult, UINT8 ucResultLen)
{
	return UartRingTx_AckBuildAddFuncResult(ucFlag, ucFuncId, pucResult, ucResultLen);
}

BOOL HAL_Uart_AckBuildCommit(void)
{
	return UartRingTx_AckBuildCommit();
}
