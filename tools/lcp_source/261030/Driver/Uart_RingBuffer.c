/* --------------- Header 정의  ---------------  */
#include <string.h>
#include "../Common/Type.h"
#include "Uart.h"
#include "Uart_RingBuffer.h"

/* --------------- Define 정의  ---------------  */
#define UART_RINGBUF_MASK      (UART_RINGBUF_SIZE - 1)
#define UART_RINGBUF_MOD_INDEX(x)   ((UINT16)((x) & UART_RINGBUF_MASK))

/* --------------- Typedef형 정의  ---------------  */

/* --------------- 함수 원형 정의  ---------------  */
static UINT16 _GetFreeSpace(void);
static void _AdvanceWritePtr(UINT16 unIncrement);
static BOOL _CopyToBuffer(const UINT8 *pucData, UINT16 unLen);
static UINT8 _ReadByte(void);
static void _StartIsr(void);
static void _StopIsr(void);
static BOOL _EnqueueHighPriorityFrame(UINT8 *pucFrame, UINT16 unLen);

/* --------------- 전역 변수 정의  ---------------  */
static UINT8 maucRingTx[UART_RINGBUF_SIZE];
static UINT16 munWritePtr;
static UINT16 munReadPtr;
static BOOL mbIsrActive;
static UINT16 munCurrentFrameBytes;
static UINT32 munMonitoringDropCount;

static UINT8 maucAckBuildFrame[UART_MAX_FRAME_SIZE];
static UINT16 munAckBuildLen;
static UINT8 mucAckBuildFuncCount;
static BOOL mbAckBuildActive;

/* --------------- 전역 상수 정의  ---------------  */

/* --------------- 함수 정의  ---------------  */
/**
* @fn static UINT16 _GetFreeSpace(void)
* Ring Buffer 내 남은 공간 계산
* @param	없음
* @return	UINT16		남은 공간 (WP/RP 구분용 1바이트 제외)
* @see		없음
*/
static UINT16 _GetFreeSpace(void)
{
	return UART_RINGBUF_MOD_INDEX(munReadPtr - munWritePtr - 1);
}

/**
* @fn static void _AdvanceWritePtr(UINT16 unIncrement)
* Write Pointer 증가 (wrap-around)
* @param	unIncrement	증가량
* @return	없음
* @see		없음
*/
static void _AdvanceWritePtr(UINT16 unIncrement)
{
	munWritePtr = UART_RINGBUF_MOD_INDEX(munWritePtr + unIncrement);
}

/**
* @fn static BOOL _CopyToBuffer(const UINT8 *pucData, UINT16 unLen)
* 데이터를 Ring Buffer에 복사
* @param	pucData	원본 데이터
* @param	unLen	복사 길이
* @return	BOOL		TRUE: 성공, FALSE: 공간 부족
* @see		없음
*/
static BOOL _CopyToBuffer(const UINT8 *pucData, UINT16 unLen)
{
	UINT16 uni;
	BOOL bResult;

	if (_GetFreeSpace() < unLen)
	{
		bResult = FALSE;
	}
	else
	{
		for (uni = 0; uni < unLen; uni++)
		{
			maucRingTx[munWritePtr] = pucData[uni];
			_AdvanceWritePtr(1);
		}

		bResult = TRUE;
	}

	return bResult;
}

/**
* @fn static UINT8 _ReadByte(void)
* Ring Buffer에서 1바이트 읽기 (RP 증가)
* @param	없음
* @return	UINT8		읽은 바이트
* @see		없음
*/
static UINT8 _ReadByte(void)
{
	UINT8 ucData;

	ucData = maucRingTx[munReadPtr];
	munReadPtr = UART_RINGBUF_MOD_INDEX(munReadPtr + 1);

	return ucData;
}

/**
* @fn static void _StartIsr(void)
* ISR 시작 (첫 바이트 송신)
* @param	없음
* @return	없음
* @see		없음
*/
static void _StartIsr(void)
{
	if ((mbIsrActive == FALSE) && (munWritePtr != munReadPtr))
	{
		mbIsrActive = TRUE;
		munCurrentFrameBytes = 0;
		Uart_PortSendByte(_ReadByte());
		munCurrentFrameBytes++;
	}
	else
	{
	}
}

/**
* @fn static void _StopIsr(void)
* ISR 중지
* @param	없음
* @return	없음
* @see		없음
*/
static void _StopIsr(void)
{
	mbIsrActive = FALSE;
	munCurrentFrameBytes = 0;
}

/**
* @fn static BOOL _EnqueueHighPriorityFrame(UINT8 *pucFrame, UINT16 unLen)
* 고우선순위 프레임 인큐 (ACK/Event)
* @param	pucFrame	프레임 버퍼
* @param	unLen	프레임 길이 (STX~ETX)
* @return	BOOL		TRUE: 성공, FALSE: 실패
* @see		없음
*/
static BOOL _EnqueueHighPriorityFrame(UINT8 *pucFrame, UINT16 unLen)
{
	UINT16 unCrc;
	BOOL bResult;

	if ((pucFrame == NULL) || (unLen < 8) || (unLen > UART_MAX_FRAME_SIZE))
	{
		bResult = FALSE;
	}
	else if (_GetFreeSpace() < unLen)
	{
		bResult = FALSE;
	}
	else
	{
		pucFrame[unLen - 3] = 0x00;
		pucFrame[unLen - 2] = 0x00;
		pucFrame[unLen - 1] = UART_ETX;

		unCrc = CRCMaker(pucFrame, (UINT16)(unLen - 3));
		pucFrame[unLen - 3] = (UINT8)(unCrc >> 8);
		pucFrame[unLen - 2] = (UINT8)unCrc;

		if (_CopyToBuffer(pucFrame, unLen) == TRUE)
		{
			_StartIsr();
			bResult = TRUE;
		}
		else
		{
			bResult = FALSE;
		}
	}

	return bResult;
}

/**
* @fn void UartRingTx_Init(void)
* Ring Buffer 초기화
* @param	없음
* @return	없음
* @see		없음
*/
void UartRingTx_Init(void)
{
	memset(maucRingTx, 0, sizeof(maucRingTx));
	memset(maucAckBuildFrame, 0, sizeof(maucAckBuildFrame));

	munWritePtr = 0;
	munReadPtr = 0;
	mbIsrActive = FALSE;
	munCurrentFrameBytes = 0;
	munMonitoringDropCount = 0;

	munAckBuildLen = 0;
	mucAckBuildFuncCount = 0;
	mbAckBuildActive = FALSE;
}

/**
* @fn BOOL UartRingTx_AckBuildBegin(UINT16 unReqSeqNo, UINT8 ucAttr)
* 함수 ACK 빌더 시작
* @param	unReqSeqNo	요청 Sequence 번호
* @param	ucAttr	속성 값
* @return	BOOL		TRUE: 성공, FALSE: 빌더 사용중
* @see		없음
*/
BOOL UartRingTx_AckBuildBegin(UINT16 unReqSeqNo, UINT8 ucAttr)
{
	BOOL bResult;

	if (mbAckBuildActive == TRUE)
	{
		bResult = FALSE;
	}
	else
	{
		maucAckBuildFrame[UARTACKFRM_STX] = UART_STX;
		maucAckBuildFrame[UARTACKFRM_LEN_H] = 0x00;
		maucAckBuildFrame[UARTACKFRM_LEN_L] = 0x00;
		maucAckBuildFrame[UARTACKFRM_FID] = UART_FID_FUNCTION_ACK;
		maucAckBuildFrame[UARTACKFRM_SEQ_H] = (UINT8)(unReqSeqNo >> 8);
		maucAckBuildFrame[UARTACKFRM_SEQ_L] = (UINT8)unReqSeqNo;
		maucAckBuildFrame[UARTACKFRM_ATTR] = ucAttr;
		maucAckBuildFrame[UARTACKFRM_FUNC_COUNT] = 0x00;

		munAckBuildLen = (UINT16)UARTACKFRM_PAYLOAD_START;
		mucAckBuildFuncCount = 0;
		mbAckBuildActive = TRUE;
		bResult = TRUE;
	}

	return bResult;
}

/**
* @fn BOOL UartRingTx_AckBuildAddFuncResult(UINT8 ucFlag, UINT8 ucFuncId, const UINT8 *pucResult, UINT8 ucResultLen)
* 함수 ACK 빌더에 결과 블록 추가
* @param	ucFlag	블록 플래그
* @param	ucFuncId	Function ID
* @param	pucResult	결과 데이터 포인터
* @param	ucResultLen	결과 데이터 길이
* @return	BOOL		TRUE: 성공, FALSE: 실패
* @see		없음
*/
BOOL UartRingTx_AckBuildAddFuncResult(UINT8 ucFlag, UINT8 ucFuncId, const UINT8 *pucResult, UINT8 ucResultLen)
{
	UINT16 unRequiredLen;
	UINT8 uci;
	BOOL bResult;

	if (mbAckBuildActive == FALSE)
	{
		bResult = FALSE;
	}
	else if (ucResultLen > UART_ACK_MAX_RESULT_LEN)
	{
		bResult = FALSE;
	}
	else if ((ucResultLen > 0) && (pucResult == NULL))
	{
		bResult = FALSE;
	}
	else
	{
		unRequiredLen = (UINT16)(3 + ucResultLen);

		if ((UINT16)(munAckBuildLen + unRequiredLen + 3) > UART_MAX_FRAME_SIZE)
		{
			bResult = FALSE;
		}
		else
		{
			maucAckBuildFrame[munAckBuildLen++] = ucFlag;
			maucAckBuildFrame[munAckBuildLen++] = (UINT8)unRequiredLen;
			maucAckBuildFrame[munAckBuildLen++] = ucFuncId;

			for (uci = 0; uci < ucResultLen; uci++)
			{
				maucAckBuildFrame[munAckBuildLen++] = pucResult[uci];
			}

			mucAckBuildFuncCount++;
			bResult = TRUE;
		}
	}

	return bResult;
}

/**
* @fn BOOL UartRingTx_AckBuildCommit(void)
* 함수 ACK 빌더 Commit
* @param	없음
* @return	BOOL		TRUE: 성공, FALSE: 실패
* @see		없음
*/
BOOL UartRingTx_AckBuildCommit(void)
{
	UINT16 unTotalLen;
	BOOL bResult;

	if (mbAckBuildActive == FALSE)
	{
		bResult = FALSE;
	}
	else
	{
		unTotalLen = (UINT16)(munAckBuildLen + 3);
		maucAckBuildFrame[UARTACKFRM_LEN_H] = (UINT8)(unTotalLen >> 8);
		maucAckBuildFrame[UARTACKFRM_LEN_L] = (UINT8)unTotalLen;
		maucAckBuildFrame[UARTACKFRM_FUNC_COUNT] = mucAckBuildFuncCount;

		bResult = _EnqueueHighPriorityFrame(maucAckBuildFrame, unTotalLen);

		mbAckBuildActive = FALSE;
		munAckBuildLen = 0;
		mucAckBuildFuncCount = 0;

		if (bResult == TRUE)
		{
			memset(maucAckBuildFrame, 0, sizeof(maucAckBuildFrame));
		}
		else
		{
			;
		}
	}

	return bResult;
}

/**
* @fn BOOL UartRingTx_EnqueueEventPacket(UINT8 ucEventType, UINT8 *pucPayload, UINT16 unPayloadLen)
* Event 패킷 인큐
* @param	ucEventType	이벤트 타입
* @param	pucPayload	페이로드 포인터
* @param	unPayloadLen	페이로드 길이
* @return	BOOL		TRUE: 성공, FALSE: 실패
* @see		없음
*/
BOOL UartRingTx_EnqueueEventPacket(UINT8 ucEventType, UINT8 *pucPayload, UINT16 unPayloadLen)
{
	UINT8 aucEventFrame[UART_MAX_FRAME_SIZE];
	UINT16 unIdx;
	UINT16 unTotalLen;
	BOOL bResult;

	if (unPayloadLen > (UINT16)(UART_MAX_FRAME_SIZE - 8))
	{
		bResult = FALSE;
	}
	else
	{
		unTotalLen = (UINT16)(1 + 2 + 1 + 1 + unPayloadLen + 2 + 1);

		unIdx = 0;
		aucEventFrame[unIdx++] = UART_STX;
		aucEventFrame[unIdx++] = (UINT8)(unTotalLen >> 8);
		aucEventFrame[unIdx++] = (UINT8)unTotalLen;
		aucEventFrame[unIdx++] = UART_FID_EVENT;
		aucEventFrame[unIdx++] = ucEventType;

		if ((unPayloadLen > 0) && (pucPayload != NULL))
		{
			UINT16 uci;
			for (uci = 0; uci < unPayloadLen; uci++)
			{
				aucEventFrame[unIdx++] = pucPayload[uci];
			}
		}
		else
		{
		}

		bResult = _EnqueueHighPriorityFrame(aucEventFrame, unTotalLen);
	}

	return bResult;
}

/**
* @fn BOOL UartRingTx_EnqueueMonitoringPacket(UINT8 *pucData, UINT16 unLen)
* Monitoring 패킷 인큐
* @param	pucData	패킷 포인터
* @param	unLen	패킷 길이
* @return	BOOL		TRUE: 성공, FALSE: 실패
* @see		없음
*/
BOOL UartRingTx_EnqueueMonitoringPacket(UINT8 *pucData, UINT16 unLen)
{
	UINT16 unFreeSpace;
	BOOL bResult;

	unFreeSpace = _GetFreeSpace();

	if ((unLen == 0) || (pucData == NULL))
	{
		bResult = FALSE;
	}
	else if (unLen > UART_MAX_FRAME_SIZE)
	{
		bResult = FALSE;
	}
	else if (unFreeSpace < unLen)
	{
		munMonitoringDropCount++;
		bResult = FALSE;
	}
	else if (_CopyToBuffer(pucData, unLen) == TRUE)
	{
		_StartIsr();
		bResult = TRUE;
	}
	else
	{
		munMonitoringDropCount++;
		bResult = FALSE;
	}

	return bResult;
}

/**
* @fn void UartRingTx_OnTxInterrupt(void)
* UART TX ISR 호출 함수
* @param	없음
* @return	없음
* @see		없음
*/
void UartRingTx_OnTxInterrupt(void)
{
	if (munWritePtr != munReadPtr)
	{
		Uart_PortSendByte(_ReadByte());
		munCurrentFrameBytes++;
	}
	else
	{
		_StopIsr();
	}
}

/**
* @fn UINT16 UartRingTx_GetFreeSpace(void)
* 남은 공간 조회
* @param	없음
* @return	UINT16		남은 바이트 수
* @see		없음
*/
UINT16 UartRingTx_GetFreeSpace(void)
{
	return _GetFreeSpace();
}

/**
* @fn UINT32 UartRingTx_GetMonitoringDropCount(void)
* 모니터링 drop 개수 조회
* @param	없음
* @return	UINT32		누적 drop 개수
* @see		없음
*/
UINT32 UartRingTx_GetMonitoringDropCount(void)
{
	return munMonitoringDropCount;
}

/**
* @fn BOOL UartRingTx_IsIsrActive(void)
* ISR 활성 상태 조회
* @param	없음
* @return	BOOL		TRUE: 활성, FALSE: 비활성
* @see		없음
*/
BOOL UartRingTx_IsIsrActive(void)
{
	return mbIsrActive;
}

