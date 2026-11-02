/* --------------- Header 정의  ---------------  */
#include <string.h>
#include "../Common/Type.h"
#include "../Common/CommonConfig.h"
#include "../Driver/Driver.h"
#include "../Driver/Timer.h"
#include "../HAL/HAL_Uart.h"
#include "CommOSP.h"
#include "RPC_Interface.h"

/* --------------- Define 정의  ---------------  */
#define COMM_RETRY_MAX_CNT				(5)		/* OSP 통신 재시도 최대 횟수 */
#define COMM_SEND_INTERVAL_MSEC			(200)	/* OSP 데이터 송신 간격 (msec) */
#define COMM_CHECK_INTERVAL_SEC			(2)		/* OSP 통신 체크 간격 (sec) */
#define COMM_CHECK_INITIAL_VALUE		(0xFF)		/* OSP 통신 체크 초기값 */

#define MAX_ARG_COUNT 					(5)
#define MAX_ARG_SIZE 					(4)	// 4 바이트 (UINT32) 기준
#define MIN_ARG_LENGTH 					(2)	// Argument Flag 1 바이트 + Argument Length 1 바이트
#define MAX_ARG_LENGTH 					(MAX_ARG_SIZE + MIN_ARG_LENGTH)	// Argument Data 최대 길이 + Argument Flag 및 Length 바이트

/* --------------- Typedef형 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */
static BOOL _ReceiveManager_And_ClearFlag(void);
static void _Parsing_ReceiveData(void);
static void _Parsing_FunctionCallData(void);
static BOOL _Parsing_Function_Block(UINT16 unFuncStartIdx, UINT8 *pucResult);
static UINT32 _Parsing_Arg_Block(UINT16 unArgStartIdx, UINT8 *pucResult);


/* --------------- 전역 변수 정의  ---------------  */
static UINT8 maucOSPSendBuffer[UARTTX_MAX];
static T_Time stTimer_SendInterval;
static T_Time stTimer_CommCheck;
static UINT8 mucCommRetryCnt = COMM_CHECK_INITIAL_VALUE;
/* --------------- 전역 상수 정의  ---------------  */


/* --------------- 함수 정의  ---------------  */
/**
* @fn void CommOSP_RegularControl(T_Context* pstContext);
* Display로 송신할 데이터를 취합/ 설정 한다.
* @param	*T_Context	JobContext정보
* @return	없음
* @see		없음
*/
void CommOSP_RegularControl(T_Context* pstContext)
{
	if (HAL_Uart_GetReceiveEndFlg() == SET)
	{	// OSP로부터 데이터 수신
		if(_ReceiveManager_And_ClearFlag() == TRUE)
		{	// CRC 통과, 수신 데이터 처리
			Timer_GetTime(&stTimer_CommCheck);
			mucCommRetryCnt = COMM_RETRY_MAX_CNT;

			// 수신 데이터 처리
			_Parsing_ReceiveData();
		}
		else
		{
			;	///< Do nothing (CRC 실패 시, 수신 데이터 처리하지 않음. OSP에서 ack 미수신 시 재전송 로직이 있을 것으로 가정)
		}		
	}
	else if(Timer_SecCheckPassTime(&stTimer_CommCheck, COMM_CHECK_INTERVAL_SEC, NONE) == TRUE)
	{	// OSP로부터 데이터 수신 안됨 (통신 이상)
		if (mucCommRetryCnt == 0)
		{	// 재시도 횟수 소진 → 시스템 Reset (타이머 갱신 불필요)
			RESET();
		}
		else
		{	// 재시도 중 (초기값 0xFF 포함) → 타이머 갱신 후 카운터 처리
			Timer_GetTime(&stTimer_CommCheck);

			if(mucCommRetryCnt <= COMM_RETRY_MAX_CNT)
			{
				mucCommRetryCnt--;
			}
			else
			{
				;
			}			
		}
	}
	else
	{
		;	///< Do nothing
	}

	if(Timer_MsecCheckPassTime(&stTimer_SendInterval, COMM_SEND_INTERVAL_MSEC, UPDATE) == TRUE)
	{	// 주기적 송신 데이터 처리
		SendMonitoringPacketEncoder(maucOSPSendBuffer, pstContext);

		HAL_Uart_SendManager(maucOSPSendBuffer);
#ifdef __SILS__
		extern UINT8 SILS_SendMonitoringBuffer[UARTTX_MAX];
		memcpy(SILS_SendMonitoringBuffer, maucOSPSendBuffer, UARTTX_MAX);
#endif
	}
	else
	{
		;	///< Do nothing
	}
}

/**
* @fn BOOL static _ReceiveManager_And_ClearFlag(void)
* 데이터 유효성 검사 및 수신 완료 플래그 클리어
* @param	없음
* @return	TRUE: 유효성 검사 통과 , FALSE: 유효성 검사 실패
*/
static BOOL _ReceiveManager_And_ClearFlag(void)
{
	BOOL bRet = FALSE;

	bRet = HAL_Uart_ReceiveManager();
	HAL_Uart_ClearReceiveEndFlg();	// 수신버퍼로 데이터 복사 후 수신 완료 플래그 클리어
	return bRet;
}

/**
* @fn void static _Parsing_ReceiveData(void)
* OSP로부터 수신한 데이터 파싱(RPC 통신)
* @param	없음
* @return	없음
*/
static void _Parsing_ReceiveData(void)
{
	UINT8 ucFID = HAL_Uart_Get_RecvBuffer(UARTRX_PACKET_FID);
	UINT16 unReqSeqNo = ((UINT16)HAL_Uart_Get_RecvBuffer(UARTRX_PACKET_SEQ_NO_H) << 8) | 
						(UINT16)HAL_Uart_Get_RecvBuffer(UARTRX_PACKET_SEQ_NO_L);
	UINT8 ucAttr = HAL_Uart_Get_RecvBuffer(UARTRX_PACKET_ATTRIBUTE);

	switch(ucFID)
	{
		case UART_FID_FUNCTION_CALL:
			if(HAL_Uart_AckBuildBegin(unReqSeqNo, ucAttr) == TRUE)
			{
				_Parsing_FunctionCallData();	// Function Call 데이터 파싱 및 수행
				HAL_Uart_AckBuildCommit();
			}
			else
			{
				;	///< Do nothing (ACK 빌더 시작 실패 시, Parsing하지 않음. OSP에서 재전송 로직이 있을 것으로 가정)
			}			
		break;

		default:
			;	///< 미구현. 추후 각 FID 별 수신 데이터 처리 로직 추가 필요 (예: UART_FID_PING 수신 시, UART_FID_PING_ACK 송신 등)
		break;
	}
}

/**
* @fn void static _Parsing_FunctionCallData(void)
* OSP로부터 수신한 데이터 파싱(RPC 통신)
* @param	없음
* @return	없음
*/
static void _Parsing_FunctionCallData(void)
{
	UINT8 ucFuncCount = HAL_Uart_Get_RecvBuffer(UARTRX_PACKET_FUNC_COUNT);
	UINT8 ucFuncLength = 0;
	UINT8 ucFuncID = 0;
	UINT8 ucResult = 0;
	UINT8 ucAckFlag = UART_ACK_FLAG_ERROR;
	UINT8 ucAckCode = 0;
	UINT16 unFuncStartIdx = UARTRX_PACKET_FUNC_BLOCK_START;
	UINT8 uci = 0;
	
	for(uci = 0; uci < ucFuncCount; uci++)
	{
		ucFuncLength = HAL_Uart_Get_RecvBuffer(unFuncStartIdx + 1);
		ucFuncID = HAL_Uart_Get_RecvBuffer(unFuncStartIdx + 2);

		if (_Parsing_Function_Block(unFuncStartIdx, &ucResult) == TRUE)
		{
			if (ucResult == SUCCESS_EXE)
			{
				ucAckFlag = UART_ACK_FLAG_RESULT;
				ucAckCode = UART_ACK_ERRORCODE_OK;
				HAL_Uart_AckBuildAddFuncResult(ucAckFlag, ucFuncID, &ucAckCode, 0);
			}
			else
			{
				ucAckFlag = UART_ACK_FLAG_ERROR;
				ucAckCode = ucResult;
				HAL_Uart_AckBuildAddFuncResult(ucAckFlag, ucFuncID, &ucAckCode, 1);
			}
		}
		else
		{
			ucAckFlag = UART_ACK_FLAG_ERROR;
			ucAckCode = ucResult;
			HAL_Uart_AckBuildAddFuncResult(ucAckFlag, ucFuncID, &ucAckCode, 1);
		}

		unFuncStartIdx += ucFuncLength;
	}
}

/**
* @fn static BOOL _Parsing_Function_Block(UINT16 unFuncStartIdx, UINT8 *pucResult)
* OSP로부터 수신한 데이터 파싱(개별 Function Block)
* @param	unFuncStartIdx	Function Data 시작 인덱스
* @param	pucResult		Function 실행 결과 반환 포인터
* @return	파싱/실행 성공 시 TRUE, 실패 시 FALSE
*/
static BOOL _Parsing_Function_Block(UINT16 unFuncStartIdx, UINT8* pucResult)
{
	UINT32 aulArg[MAX_ARG_COUNT] = {0, };	// Function Argument (최대 5 개 x 4 바이트로 가정)
	UINT8 ucFuncID = HAL_Uart_Get_RecvBuffer(unFuncStartIdx + 2);	// Function ID (Function Data 내 3 번째 바이트)
	UINT8 ucArgCount = HAL_Uart_Get_RecvBuffer(unFuncStartIdx + 3);	// Argument Count (Function Data 내 4 번째 바이트)	
	UINT16 unIdx = 0;
	UINT8 uci = 0;
	UINT8 ucResult = 0;
	BOOL bRet = FALSE;

	if(pucResult == NULL)	return FALSE;	// 반환 포인터 유효성 검증

	if(HAL_Uart_Get_RecvBuffer(unFuncStartIdx) == UART_FUNC_FLAG_EXEC)	// Function Flag 확인
	{
		// 세부 데이터 파싱 및 설정
		// 1. Arg SET
		if(ucArgCount <= MAX_ARG_COUNT)
		{
			unIdx = unFuncStartIdx + 4;	// Argument Data 시작 인덱스
			// Arg 추출 Func -> aulArg[] 채워짐
			for(uci = 0; uci < ucArgCount; uci++)
			{
				aulArg[uci] = _Parsing_Arg_Block(unIdx, &ucResult);
				unIdx += HAL_Uart_Get_RecvBuffer(unIdx + 1);	// Argument Data는 4 바이트로 가정
				
				if(ucResult != 0)	break;	// Argument Parsing 실패 시, 이후 Argument는 Parsing하지 않음.
			}
		}
		else
		{
			ucResult = ERROR_NOT_PARSING_ARG;	// Argument Parsing Error : Invalid Argument Count
		}

		// 2. Function ID 확인 후 Function 수행
		if(ucResult == 0)
		{
			ucResult = ExecuteFunctionCall(ucFuncID, aulArg, ucArgCount);	// Function 수행 (Function ID 및 Argument 전달)
			bRet = TRUE;
		}
		else
		{
			bRet = FALSE;	// Argument Parsing 실패 시, Function 수행하지 않음.
		}

		*pucResult = ucResult;
	}
	else
	{
		*pucResult = ERROR_NOT_PARSING_FUNC;	// Function Parsing Error : Invalid Function Flag
		bRet = FALSE;
	}

	return bRet;
}

/**
* @fn void static _Parsing_Arg_Block(UINT16 unArgStartIdx)
* OSP로부터 수신한 데이터 파싱(개별 Argument Block)
* @param	unArgStartIdx	Argument Data 시작 인덱스
* @return	Argument 값
*/
static UINT32 _Parsing_Arg_Block(UINT16 unArgStartIdx, UINT8 *pucResult)
{
	UINT32 ulArgValue = 0;
	UINT8 ucArgLength = HAL_Uart_Get_RecvBuffer(unArgStartIdx + 1);	// Argument Length (Argument Data 길이 + Argument Flag 1 바이트 + Argument Length 1 바이트)
	UINT8 uci = 0;


	if(	(HAL_Uart_Get_RecvBuffer(unArgStartIdx) == UART_FUNC_FLAG_ARG) && 
		(ucArgLength >= MIN_ARG_LENGTH) && (ucArgLength <= MAX_ARG_LENGTH)	)
	{
		ucArgLength -= MIN_ARG_LENGTH;	// Argument Data 길이 (Argument Flag 1 바이트 + Argument Length 1 바이트 제외)
		for (uci = 0; uci < ucArgLength; uci++)
		{
			ulArgValue |= ((UINT32)HAL_Uart_Get_RecvBuffer(unArgStartIdx + 2 + uci)) << (8 * uci);
		}
	}
	else
	{
		if (pucResult != NULL)	*pucResult = ERROR_NOT_PARSING_ARG;		// Argument Parsing Error : Invalid Flag or Invalid Length
	}
	
	return ulArgValue;
}