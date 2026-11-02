#ifndef UART_RINGBUFFER_H_
#define UART_RINGBUFFER_H_

#define UART_RINGBUF_SIZE			(512)
#define UART_MAX_FRAME_SIZE			(512)

#define UART_STX					(0xAA)
#define UART_ETX					(0xBB)

#define UART_FID_FUNCTION_CALL		(0xCF)
#define UART_FID_FUNCTION_ACK		(0xCD)
#define UART_FID_PING				(0xCE)
#define UART_FID_PACKET_ACK			(0xCC)
#define UART_FID_MONITORING			(0xCA)
#define UART_FID_EVENT				(0xC9)
#define UART_FID_EXT_HEARTBEAT		(0xBC)

/* RPC/ACK protocol flags */
#define UART_FUNC_FLAG_ARG			(0xFA)
#define UART_FUNC_FLAG_DATA			(0xFB)
#define UART_FUNC_FLAG_EXEC			(0xFC)
#define UART_ACK_FLAG_RESULT		(0xFD)
#define UART_ACK_FLAG_ERROR			(0xFE)

/* keep old names for compatibility */
#define UART_ACK_BLOCK_FLAG_OK		UART_ACK_FLAG_RESULT
#define UART_ACK_BLOCK_FLAG_ERR		UART_ACK_FLAG_ERROR

/* ACK error code */
#define UART_ACK_ERRORCODE_OK		(0xF0)
#define UART_ACK_ATTR_DEFAULT		(0x00)
#define UART_ACK_MAX_RESULT_LEN		(16)

typedef enum
{
    UARTACKFRM_STX = 0,
    UARTACKFRM_LEN_H,
    UARTACKFRM_LEN_L,
    UARTACKFRM_FID,
    UARTACKFRM_SEQ_H,
    UARTACKFRM_SEQ_L,
    UARTACKFRM_ATTR,
    UARTACKFRM_FUNC_COUNT,
    UARTACKFRM_PAYLOAD_START
} UartAckFrameHeaderIndex_t;

void UartRingTx_Init(void);
BOOL UartRingTx_AckBuildBegin(UINT16 unReqSeqNo, UINT8 ucAttr);
BOOL UartRingTx_AckBuildAddFuncResult(UINT8 ucFlag, UINT8 ucFuncId, const UINT8 *pucResult, UINT8 ucResultLen);
BOOL UartRingTx_AckBuildCommit(void);
BOOL UartRingTx_EnqueueEventPacket(UINT8 ucEventType, UINT8 *pucPayload, UINT16 unPayloadLen);
BOOL UartRingTx_EnqueueMonitoringPacket(UINT8 *pucData, UINT16 unLen);
void UartRingTx_OnTxInterrupt(void);

UINT16 UartRingTx_GetFreeSpace(void);
UINT32 UartRingTx_GetMonitoringDropCount(void);
BOOL UartRingTx_IsIsrActive(void);

#endif /* UART_RINGBUFFER_H_ */
