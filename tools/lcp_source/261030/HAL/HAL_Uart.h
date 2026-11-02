/*
 * HAL_Uart.h
 *
 *  Created on: 2013. 8. 29.
 *      Author: seongju.lim
 */

#ifndef HAL_UART_H_
#define HAL_UART_H_

#include "../Driver/Uart.h"
#include "../Driver/Uart_RingBuffer.h"

void HAL_Uart_ISR_Timer_10ms(void);
void HAL_Uart_ClearReceiveEndFlg(void);
BOOL HAL_Uart_GetReceiveEndFlg(void);
UINT8 HAL_Uart_Get_RecvBuffer(UINT16 eRxIndex);
void HAL_Uart_Initial(void);
void HAL_Uart_ISR_Sending_CommData(void);
void HAL_Uart_ISR_Recving_CommData(void);
void HAL_Uart_SendManager(UINT8* pucSendBuffer);
BOOL HAL_Uart_ReceiveManager(void);

BOOL HAL_Uart_AckBuildBegin(UINT16 unReqSeqNo, UINT8 ucAttr);
BOOL HAL_Uart_AckBuildAddFuncResult(UINT8 ucFlag, UINT8 ucFuncId, const UINT8 *pucResult, UINT8 ucResultLen);
BOOL HAL_Uart_AckBuildCommit(void);

#endif /* HAL_UART_H_ */
