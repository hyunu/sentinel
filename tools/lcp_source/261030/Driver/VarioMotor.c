/*
 * VarioMotor.c
 *
 *  Created on: 2013. 7. 16.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "./Device/RX130.h"
#include "./Driver.h"
#include "Timer.h"
#include "VarioMotor.h"

/* --------------- Define 정의  ---------------  */
#define		READ_VARIOSW_GAP					(2)
#define		VARIO_RISINGSIGNAL_CHATERRING_CNT	(8)
#define		VARIO_FALLINGSIGNAL_CHATERRING_CNT	(3)
#define		VARIOCAM_MAX						(3)
#define		MAXVARIOPOSITION					(8)		// 최대 Vario 위치수 (undefine 포함)
#define		READ_VARIOSENSOR_GAP				(1)
#define		VARIO_MIN_TIME						(16)	// 50ms * 16 = 800ms
#define		VARIO_MAX_TIME						(25)	// 50ms * 25 = 1250ms
#define		VARIO_SWCHECKTIME_MS				(600)
#define		VARIO_CHANGE_LIMIT_TIME_SEC			(30)
#define		VARIO_FINDBASE_LIMIT_TIME_SEC		(750)
#define		VARIO_FINDBASE_RETRYCHECK_TIME_SEC	(48)
#define		VARIO_FINDBASE_RETRYSTOP_TIME_SEC	(2)


/* --------------- Typedef형 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */
static T_E_VarioSWEdge _VarioMotor_DetectEdgeSignal(void);
static BOOL _VarioMotor_RotatePosition(void);
static void _VarioMotor_ClearRotatePosition(void);

static void _StateMachine_VarioMotor_FindBasePoint(void);
static void _StateMachine_VarioMotor_MoveVarioPosition(void);

static void _VarioMotor_MoveToBasePoint(UINT8* pucMoveIndex, T_E_VarioSWEdge eVarioEdge);
static void _VarioMotor_ClearVarioSW_OnTime(void);
static UINT16 _VarioMotor_GetVarioSW_OnTime(void);

static void _VarioMotor_FindInitialRising(BOOL* bIgnore_InitialRising, T_E_VarioSWEdge eVarioEdge);
static void _VarioMotor_WaitFallingEdge(BOOL* bIgnore_InitialRising, T_E_VarioSWEdge eVarioEdge);

/* --------------- 전역 변수 정의  ---------------  */
static BOOL mb_IsOn;	// 내부 상태 변수
static T_E_VarioMotorState meVarioMotorState;			//StateMachine 상태
static T_E_VarioMotorRequest meVarioMotorRequest;		//Request 종류
static T_E_VarioMotorRequest meVarioMotorPrevRequest;	//정지, 재시작을 위한 이전 요청 저장값
static T_E_VarioSWEdge meVarioEdgeState;			//VarioSW 상태
static T_E_VarioStatus meCurVarioPosition, meTarVarioPosition;	//Vario Cur, Tar 위치
static UINT16 munVarioSW_OnTime; //Vario 초기화 시, vario SW ON 시간 측정용 변수
static const UINT8 maucVarioInitMove[VARIOCAM_MAX] = {1, 2, 0}; /* Vario Cam Init Cam 위치에 따른 이동 횟수 테이블 */

static const T_E_VarioStatus maeNextVarioPosition[VARIOSTATUS_MAX] = { VARIOSTATUS_UNDEFINE, VARIOSTATUS_ALL, VARIOSTATUS_TOP, VARIOSTATUS_LOWERTOP, VARIOSTATUS_LOWER, VARIOSTATUS_NONE, VARIOSTATUS_UPPER};
static BOOL mbCoutingFallingEdge;		//Target변경 요청시, Falling Edge 들어올 때 계산하기 위한 Flag
static BOOL mbCoutingRisingEdge;		//Target변경 요청시, Rising Edge 들어올 때 계산하기 위한 Flag
static BOOL mbFirstLowSignal;
static BOOL mbFirstHighSignal;
static BOOL mbFirstVarioInitFlag;
static UINT8 mucFirstVarioInitTime;

static UINT8 mucVarioSWCheckCount;
static T_Time mstTimer_VarioSWCheck;
static T_Time mstTimer_VarioMoveCheck;
static T_Time mstTimer_VarioFindBaseCheck;
static T_Time mstTimer_VarioFindBaseRetryCheck;
static T_Time mstTimer_VarioFindBaseRetryStop;
static T_Time mstTimer_FirstVarioFindBaseCheckTimer;


/**
* @fn void VarioMotor_RequestToFindBasePoint(void)
* Vario 기준점 찾기 요청
* @param	없음
* @return	없음
* @see		Vario 모터 기준점 찾기 요청
*/
void VarioMotor_RequestToFindBasePoint(void)
{
	Timer_GetTime(&mstTimer_VarioFindBaseCheck);
	Timer_GetTime(&mstTimer_FirstVarioFindBaseCheckTimer);
	meVarioMotorRequest = VARIOMOTOR_REQUEST_FINDBASEPOINT;
	meVarioMotorState = VARIOMOTOR_STATE_INIT;
}

/**
* @fn void VarioMotor_RequestToRotateVarioPosition(T_E_VarioStatus TargetVarioPosition
* Vario 초기화 후, Target 변경 요청
* @param	T_E_VarioMotorPosition TargetVarioPosition 타겟 노즐 위치
* @return	없음
* @see		Vario TargetNozzle 변경 요청
*/
void VarioMotor_RequestToRotateVarioPosition(T_E_VarioStatus TargetVarioPosition)
{
	if(meCurVarioPosition != VARIOSTATUS_UNDEFINE)
	{
		meTarVarioPosition = TargetVarioPosition;
	}
	else
	{
		; ///do nothing
	}

	if((meCurVarioPosition != meTarVarioPosition) && (meTarVarioPosition != VARIOSTATUS_UNDEFINE))
	{
		Timer_GetTime(&mstTimer_VarioMoveCheck);
		meVarioMotorRequest = VARIOMOTOR_REQUEST_MOVENOZZLE;
		meVarioMotorState = VARIOMOTOR_STATE_MOVETARPOSITION;
	}
	else
	{
		; ///do nothing
	}
}

/**
* @fn void VarioMotor_RequestToStop(void)
* Vario 모터  정지 요청
* @param	없음
* @return	없음
* @see		Vario 모터  정지 요청
*/
void VarioMotor_RequestToStop(void)
{
	if((meVarioMotorState == VARIOMOTOR_STATE_COMPLETE_MOVE_TARGETPOS) || (meVarioMotorState == VARIOMOTOR_STATE_FINAL_ERROR))
	{
		meVarioMotorPrevRequest = VARIOMOTOR_REQUEST_NONE;
		meVarioMotorRequest = VARIOMOTOR_REQUEST_NONE;
	}
	else
	{
		if(meVarioMotorRequest != VARIOMOTOR_REQUEST_NONE)
		{
			meVarioMotorPrevRequest = meVarioMotorRequest;
			meVarioMotorRequest = VARIOMOTOR_REQUEST_NONE;
			VarioMotor_TurnOff();
		}
		else
		{
			; ///<<do nothing
		}
	}
}

/**
* @fn void VarioMotor_RequestToResume(void)
* Vario모터  재시작 요청
* @param	없음
* @return	없음
* @see		Vario 모터 동작 재개 요청(이전 요청값으로 저장)
*/
void VarioMotor_RequestToResume(void)
{
	if(meVarioMotorPrevRequest != VARIOMOTOR_REQUEST_NONE)
	{
		meVarioMotorRequest = meVarioMotorPrevRequest;
		meVarioMotorPrevRequest = VARIOMOTOR_REQUEST_NONE; // 이전 요청값 Clear 함.
		VarioMotor_TurnOn();
	}
	else
	{
		; ///<<do nothing
	}
}

/**
* @fn void VarioMotor_RequestToSetVarioPosition(T_E_VarioStatus eVarioPosition)
* 현재 Vario 위치 설정 요청
* @param							T_E_VarioStatus eVarioPosition Vario 설정 위치
* @return	없음
* @see
*/
void VarioMotor_RequestToSetVarioPosition(T_E_VarioStatus eVarioPosition)
{
	if((meCurVarioPosition == VARIOSTATUS_UNDEFINE) && (meVarioMotorRequest == VARIOMOTOR_REQUEST_NONE))
	{
		meCurVarioPosition = eVarioPosition;
		meTarVarioPosition = eVarioPosition;
		meVarioMotorState = VARIOMOTOR_STATE_COMPLETE_MOVE_TARGETPOS;
	}
	else
	{
		;	///< Do nothing
	}
}

/**
* @fn void VarioMotor_RegularControl(void)
* concurrent 에서 매 주기마다 호출되는 함수 (요청 값에 따라 실행하는 함수가 달라진다.)
* @param	없음
* @return	없음
* @see		main 주기마다 실행하는 함수
*/
void VarioMotor_RegularControl(void)
{
	if(meVarioMotorRequest == VARIOMOTOR_REQUEST_FINDBASEPOINT)
	{
		_StateMachine_VarioMotor_FindBasePoint();
	}
	else if(meVarioMotorRequest == VARIOMOTOR_REQUEST_MOVENOZZLE)
	{
		_StateMachine_VarioMotor_MoveVarioPosition();
	}
	else
	{
		; ///do nothing
	}
}

/**
* @fn void VarioMotor_Isr_Timer_50ms_CheckTimer(void)
* 50ms마다 호출되는 함수
* @param	없음
* @return	없음
* @see		50ms 주기마다 실행하는 함수 - 기준점 찾을때, Cam 3축의 ON 시간을 측정하기 위한 변수.
*/
void VarioMotor_Isr_Timer_50ms_CheckTimer(void)
{
	if (munVarioSW_OnTime < UINT16_MAX_VALUE)	// 기준점 찾을때, RisingEdge 후 FallingEdge 될때까지 시간을 측정하는 변수
	{
		munVarioSW_OnTime++;
	}
	else
	{
		;	///< Do nothing
	}
}

/**
* @fn void VarioMotor_Isr_Timer_50ms_SensingSignal(void)
* 50ms마다 호출되는 함수
* @param	없음
* @return	없음
* @see		50ms 주기마다 실행하는 함수
* 		Vario SW 신호확인하여 Edge판단하는 함수 호출한다.
*/
void VarioMotor_Isr_Timer_50ms_SensingSignal(void)
{
	meVarioEdgeState = _VarioMotor_DetectEdgeSignal();	//50ms 마다 Edge 신호 판단을 한다.
}

/**
* @fn static void _VarioMotor_ClearVarioSW_OnTime(void)
* Cam 3축의 ON 시간을 측정하기 위한 변수 값 Clear
* @param	없음
* @return	없음
* @see		Cam 3축의 ON 시간을 측정하기 위한 변수 값 Clear
*/
static void _VarioMotor_ClearVarioSW_OnTime(void)
{
	munVarioSW_OnTime = CLEAR;
}

/**
* @fn static UINT16 _VarioMotor_GetVarioSW_OnTime(void)
* Cam ON 시간 측정 값 get
* @param	없음
* @return	UINT16 시간 측정 값 return
* @see		Cam ON 시간 측정 값 get
*/
static UINT16 _VarioMotor_GetVarioSW_OnTime(void)
{
	return munVarioSW_OnTime;
}



/**
* @fn static T_E_VarioSWEdge _VarioMotor_DetectEdgeSignal(void)
* VarioSW 신호 확인 후 Rising,Falling,Flat return 함.
* @param	없음
* @return	T_E_VarioSWEdge VarioSW: Rising,Falling,Flat
* @see		50ms 인터럽트에서 호출. VarioSW 신호 확인 후 Rising,Falling,Flat return 함.
*/
static T_E_VarioSWEdge _VarioMotor_DetectEdgeSignal(void)
{
	static UINT8 mucVarioHighSignal;	// SW HighSignal Count 저장변수
	static UINT8 mucVarioLowSignal;		// SW LowSignal Count 저장변수
	T_E_VarioSWEdge eReturn = VARIOSW_FLAT;

	if(VARIOPOSITIONSW_PORT == TRUE)
	{
		mucVarioLowSignal = CLEAR;
		if(mucVarioHighSignal >= VARIO_RISINGSIGNAL_CHATERRING_CNT)
		{
			eReturn = VARIOSW_RISINGEDGE;
		}
		else
		{
			mucVarioHighSignal++;
		}
	}
	else
	{
		mucVarioHighSignal = CLEAR;
		if(mucVarioLowSignal >= VARIO_FALLINGSIGNAL_CHATERRING_CNT)
		{
			eReturn = VARIOSW_FALLINGEDGE;
		}
		else
		{
			mucVarioLowSignal++;
		}
	}

	return eReturn;
}

/**
* @fn UINT8 Get_VarioBasePointMoveIndex(void)
* @param	없음
* @return	기준점으로 가기 위한 Falling Edge 필요 수
* @see		3곳의 측정값 중 가장 짧은 곳을 확인하여, 현재 위치로부터 초기화 위치로 이동하기 위해 필요한 FallingEdge 수를 return 한다.
*/
UINT8 Get_VarioBasePointMoveIndex(UINT16* paunVarioInitTime)
{
	register INT8 ci = 0;
	UINT16 unTempTime = paunVarioInitTime[0];
	UINT8 ucFindIndex = 0;

	for( ci = 0 ; ci < VARIOCAM_MAX  ; ci++)
	{
		if( unTempTime > paunVarioInitTime[ci] )
		{
			unTempTime = paunVarioInitTime[ci];
			ucFindIndex = ci;
		}
		else
		{
			;	///< do nothing
		}
	}

	return maucVarioInitMove[ucFindIndex];
}



/**
* @fn static void _StateMachine_VarioMotor_FindBasePoint(void)
* @param	없음
* @return	없음
* @see		기준점 찾기 위한 함수.
* 		- Cam On시간을 3군데 측정하여 가장 짧은 곳이 기준점이 된다.
* 		측정 후, 그곳까지 이동하는게 기준점 찾기 동작 완료.
*/
static void _StateMachine_VarioMotor_FindBasePoint(void)
{
	static UINT8 ucVarioInitArrIndex;
	static UINT8 ucMoveIndex;
	static BOOL bIgnore_InitialRising;
	static UINT16 aunVarioInitTime[VARIOCAM_MAX];	// 기준점 찾기 위한 3군데 SW on 시간 저장 배열
	UINT8 uci = 0;
	T_E_VarioSWEdge eVarioEdge = meVarioEdgeState;
	/*interrupt를 통해 받은 Edge 상태값으로 Main 실행.
	 *함수 실행 중,Interrupt에 의해 중간에 값이 바뀌면 안되므로, 함수 안에서 값을 받음.
	 */

	switch(meVarioMotorState)
	{
		case VARIOMOTOR_STATE_INIT :
			ucVarioInitArrIndex  = 0;
			for(uci = 0 ; uci < VARIOCAM_MAX ; uci++)
			{
				aunVarioInitTime[uci] = 0;
			}
			meCurVarioPosition = VARIOSTATUS_UNDEFINE;
			meTarVarioPosition = VARIOSTATUS_UNDEFINE;	/* 노즐 상태는 UNDEFINE 으로 */

			_VarioMotor_FindInitialRising(&bIgnore_InitialRising, eVarioEdge); /* Vario 모터 On 하기 전 들어오는 Rising, Flat 신호는 무시한다 */
			VarioMotor_TurnOn(); /*	Vario 모터 ON */

			Timer_GetTime(&mstTimer_VarioFindBaseRetryCheck);

			meVarioMotorState = VARIOMOTOR_STATE_WAIT_ON_RISINGEDGE;
		break;

		case VARIOMOTOR_STATE_WAIT_ON_RISINGEDGE :
			_VarioMotor_WaitFallingEdge(&bIgnore_InitialRising, eVarioEdge);// 초기 감지시의 high는 무시
			if((eVarioEdge == VARIOSW_RISINGEDGE) && (bIgnore_InitialRising == FALSE))
			{
				_VarioMotor_ClearVarioSW_OnTime();
				Timer_GetTime(&mstTimer_VarioSWCheck);
				meVarioMotorState = VARIOMOTOR_STATE_WAIT_ON_FALLINGEDGE;
			}
			else
			{
				; ///do nothing
			}

			if(Timer_SecCheckPassTime(&mstTimer_VarioFindBaseRetryCheck, VARIO_FINDBASE_RETRYCHECK_TIME_SEC, NONE) == TRUE)
			{
				VarioMotor_TurnOff();
				Timer_GetTime(&mstTimer_VarioFindBaseRetryStop);
				meVarioMotorState = VARIOMOTOR_STATE_RETRY_FIND_BASEPOINT;
			}
			else
			{
				;
			}
		break;

		case VARIOMOTOR_STATE_WAIT_ON_FALLINGEDGE :
			if(eVarioEdge == VARIOSW_FALLINGEDGE)
			{
				aunVarioInitTime[ucVarioInitArrIndex] = _VarioMotor_GetVarioSW_OnTime();
				ucVarioInitArrIndex++;

				if(ucVarioInitArrIndex < VARIOCAM_MAX)
				{
					if((_VarioMotor_GetVarioSW_OnTime() >= VARIO_MIN_TIME) && (_VarioMotor_GetVarioSW_OnTime() <= VARIO_MAX_TIME))
					{
						ucMoveIndex = maucVarioInitMove[2];                        // 가장 짧은 시간 측정 기준으로 초기화 위치로 이동한다
						meVarioMotorState = VARIOMOTOR_STATE_MOVE_TO_BASEPOINT;
					}
					else
					{
						meVarioMotorState = VARIOMOTOR_STATE_WAIT_ON_RISINGEDGE;
					}
				}
				else
				{
					ucMoveIndex = Get_VarioBasePointMoveIndex(aunVarioInitTime);	// 3군데 Cam 측정시간을 끝냈을 때, 가장 짧은 시간 측정 기준으로 초기화 위치로 이동한다. (fallEdge필요개수 확인)
					meVarioMotorState = VARIOMOTOR_STATE_MOVE_TO_BASEPOINT;
				}

				if(Timer_MsecCheckPassTime(&mstTimer_VarioSWCheck, VARIO_SWCHECKTIME_MS, NONE) == FALSE)
				{
					INC_UINT8_SAFETY(mucVarioSWCheckCount);
				}
				else
				{
					;
				}
			}
			else
			{
				; ///do nothing
			}

			if(Timer_SecCheckPassTime(&mstTimer_VarioFindBaseRetryCheck, VARIO_FINDBASE_RETRYCHECK_TIME_SEC, NONE) == TRUE)
			{
				VarioMotor_TurnOff();
				Timer_GetTime(&mstTimer_VarioFindBaseRetryStop);
				meVarioMotorState = VARIOMOTOR_STATE_RETRY_FIND_BASEPOINT;
			}
			else
			{
				;
			}
		break;

		case VARIOMOTOR_STATE_MOVE_TO_BASEPOINT :
			_VarioMotor_MoveToBasePoint(&ucMoveIndex, eVarioEdge);

			if(Timer_SecCheckPassTime(&mstTimer_VarioFindBaseRetryCheck, VARIO_FINDBASE_RETRYCHECK_TIME_SEC, NONE) == TRUE)
			{
				VarioMotor_TurnOff();
				Timer_GetTime(&mstTimer_VarioFindBaseRetryStop);
				meVarioMotorState = VARIOMOTOR_STATE_RETRY_FIND_BASEPOINT;
			}
			else
			{
				;
			}
		break;

		case VARIOMOTOR_STATE_COMPLETE_FIND_BASEPOINT :
			meVarioMotorRequest = VARIOMOTOR_REQUEST_NONE;
			mbFirstVarioInitFlag = FALSE;		// 첫 Vario 기준점 찾기 완료 시, Flag Clear함.
		break;

		case VARIOMOTOR_STATE_RETRY_FIND_BASEPOINT :
			if(Timer_SecCheckPassTime(&mstTimer_VarioFindBaseRetryStop, VARIO_FINDBASE_RETRYSTOP_TIME_SEC, NONE) == TRUE)
			{
				meVarioMotorState = VARIOMOTOR_STATE_INIT;
			}
			else
			{
				;
			}
		break;

		default :
		break;
	}

	if(Timer_SecCheckPassTime(&mstTimer_VarioFindBaseCheck, VARIO_FINDBASE_LIMIT_TIME_SEC, NONE) == TRUE)
	{
		meVarioMotorState = VARIOMOTOR_STATE_FINAL_ERROR;
		VarioMotor_TurnOff();
	}
	else
	{
		;
	}

	if(mbFirstVarioInitFlag == TRUE)	// 최초 Vario 초기화 시 동작시간 측정(Superset 전송용)
	{
		if(Timer_SecCheckPassTime(&mstTimer_FirstVarioFindBaseCheckTimer, TIME_1SEC, UPDATE) == TRUE)
		{
			INC_UINT8_SAFETY(mucFirstVarioInitTime);
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

/**
* @fn static void _VarioMotor_FindInitialRising(BOOL* bIgnore_InitialRising, T_E_VarioSWEdge eVarioEdge)
*  Vario 모터 On 하기 전 들어오는 Rising, Flat 신호는 무시한다
* @param	BOOL*			최초 RisingEdge 신호 확인용 Flag
* @param	T_E_VarioSWEdge 현재 VarioSW 상태
* @return	없음
* @see		없음
*/
static void _VarioMotor_FindInitialRising(BOOL* pbIgnore_InitialRising, T_E_VarioSWEdge eVarioEdge)
{
	/* Vario 모터 On 하기 전 들어오는 Rising, Flat 신호는 무시한다 */
	if( (eVarioEdge == VARIOSW_RISINGEDGE) || (eVarioEdge == VARIOSW_FLAT))
	{
		*pbIgnore_InitialRising = TRUE;
	}
	else
	{
		*pbIgnore_InitialRising = FALSE;
	}
}

/**
* @fn static void _VarioMotor_WaitFallingEdge(BOOL* bIgnore_InitialRising, T_E_VarioSWEdge eVarioEdge)
*  최초 Rising 신호일 경우, FallingEdge가 들어올때까지 대기한다.
* @param	BOOL*			최초 RisingEdge 신호 확인용 Flag
* @param	T_E_VarioSWEdge 현재 VarioSW 상태
* @return	없음
* @see		없음
*/
static void _VarioMotor_WaitFallingEdge(BOOL* pbIgnore_InitialRising, T_E_VarioSWEdge eVarioEdge)
{
	if((eVarioEdge == VARIOSW_FALLINGEDGE) && (*pbIgnore_InitialRising == TRUE))
	{
		*pbIgnore_InitialRising = FALSE;
	}
	else
	{
		;	///< Do nothing
	}
}
/**
* @fn static void _VarioMotor_MoveToBasePoint(UINT8* pucMoveIndex, T_E_VarioSWEdge eVarioEdge)
* @param	없음
* @return	없음
* @see		기준점 찾기 위한 함수.
* 		- Cam On시간을 3군데 측정하여 가장 짧은 곳이 기준점이 된다.
* 		측정 후, 그곳까지 이동하는게 기준점 찾기 동작 완료.
*/
static void _VarioMotor_MoveToBasePoint(UINT8* pucMoveIndex, T_E_VarioSWEdge eVarioEdge)
{
	if(*pucMoveIndex == 2)
	{
		meCurVarioPosition = VARIOSTATUS_TOP;
		meTarVarioPosition = VARIOSTATUS_TOP;
	}
	else if (*pucMoveIndex == 1)
	{
		meCurVarioPosition = VARIOSTATUS_LOWER;
		meTarVarioPosition = VARIOSTATUS_LOWER;
	}
	else
	{
		meCurVarioPosition = VARIOSTATUS_UPPER;
		meTarVarioPosition = VARIOSTATUS_UPPER;
	}

	VarioMotor_TurnOff();
	meVarioMotorState = VARIOMOTOR_STATE_COMPLETE_FIND_BASEPOINT;
	_VarioMotor_ClearRotatePosition();
}

/**
* @fn	static void _StateMachine_VarioMotor_MoveVarioPosition(void)
* @param	없음
* @return	없음
* @see		기준점 찾기 완료 후, Target Nozzle 로 이동.
* 		-기준점 찾기 완료 후, Vario 모터 정지 후 Request값 Clear한다.
*/
static void _StateMachine_VarioMotor_MoveVarioPosition(void)
{
	BOOL bReturn = FALSE;

	switch(meVarioMotorState)
	{
		case VARIOMOTOR_STATE_MOVETARPOSITION:
			bReturn = _VarioMotor_RotatePosition();
			if(bReturn == TRUE)
			{
				meCurVarioPosition = meTarVarioPosition;
				VarioMotor_TurnOff();
				meVarioMotorState = VARIOMOTOR_STATE_COMPLETE_MOVE_TARGETPOS;
			}
			else
			{
				if(Timer_SecCheckPassTime(&mstTimer_VarioMoveCheck, VARIO_CHANGE_LIMIT_TIME_SEC, NONE) == TRUE)
				{
					VarioMotor_TurnOff();
					meVarioMotorState = VARIOMOTOR_STATE_FINAL_ERROR;
				}
				else
				{
					VarioMotor_TurnOn();
				}
			}
		break;

		case VARIOMOTOR_STATE_COMPLETE_MOVE_TARGETPOS:
		case VARIOMOTOR_STATE_FINAL_ERROR:
			meVarioMotorRequest = VARIOMOTOR_REQUEST_NONE;
		break;

		default:
		break;
	}
}

/**
* @fn static void _VarioMotor_ClearRotatePosition(void)
* Rotate Position Flag Clear
* @param		 없음
* @return	없음
* @see		없음.
*/
static void _VarioMotor_ClearRotatePosition(void)
{
	mbCoutingFallingEdge = FALSE;
	mbCoutingRisingEdge = FALSE;
	mbFirstLowSignal = FALSE;
	mbFirstHighSignal = FALSE;
}

/**
* @fn	static BOOL _VarioMotor_RotatePosition(void)
* @param
* @return	BOOL Target까지 이동했는지 여부 return
* @see		 현재 위치에서 Target까지 가기위한 Edge수 파악 하여, Edge수와 Counting 한 값이 같다면
* 		True Return 함.
*/
static BOOL _VarioMotor_RotatePosition(void)
{
	T_E_VarioSWEdge eVarioEdge = meVarioEdgeState;	//함수 실행 중,Interrupt에 의해 중간에 값이 바뀌면 안되므로, 함수 안에서 값을 받음.
	BOOL bReturn = FALSE;

	/* Falling Edge를 카운터 할 때, 처음에 Vario가 Low 신호에 있을 경우에는  카운팅 하지 않고, High 신호의 다음부터 카운팅 함 */
	if(eVarioEdge == VARIOSW_RISINGEDGE)
	{
		mbFirstHighSignal = TRUE;
		mbCoutingFallingEdge = FALSE;
	}
	/* Vario 구동 중 Falling Edge의 카운팅 */
	else if((eVarioEdge == VARIOSW_FALLINGEDGE) && (mbFirstHighSignal == TRUE))
	{
		if(mbCoutingFallingEdge == FALSE)
		{
			mbCoutingFallingEdge = TRUE;
			meCurVarioPosition = maeNextVarioPosition[meCurVarioPosition];
			if(meCurVarioPosition == meTarVarioPosition)
			{
				bReturn = TRUE;
			}
			else
			{
				;
			}
			if(Timer_MsecCheckPassTime(&mstTimer_VarioSWCheck, VARIO_SWCHECKTIME_MS, NONE) == FALSE)
			{
				INC_UINT8_SAFETY(mucVarioSWCheckCount);
			}
			else
			{
				;
			}
		}
		else
		{
			; ///<do nothing
		}
	}
	else
	{
		;	///< Do nothing
	}

	/* Rising Edge를 카운터 할 때, 처음에 Vario가 High 신호에 있을 경우에는  카운팅 하지 않고, Low 신호의 다음부터 카운팅 함 */
	if(eVarioEdge == VARIOSW_FALLINGEDGE)
	{
		mbFirstLowSignal = TRUE;
		mbCoutingRisingEdge = FALSE;
	}
	else if((eVarioEdge == VARIOSW_RISINGEDGE) && (mbFirstLowSignal == TRUE))
	{
		if(mbCoutingRisingEdge == FALSE)
		{
			mbCoutingRisingEdge = TRUE;
			meCurVarioPosition = maeNextVarioPosition[meCurVarioPosition];
			if(meCurVarioPosition == meTarVarioPosition)
			{
				bReturn = TRUE;
			}
			else
			{
				Timer_GetTime(&mstTimer_VarioSWCheck);
			}
		}
		else
		{
			; ///<do nothing
		}
	}
	else
	{
		;	///< Do nothing
	}

	if(bReturn == TRUE)
	{
		_VarioMotor_ClearRotatePosition();
	}
	else
	{
		;
	}

	return(bReturn);
}

/**
* @fn	T_E_VarioMotorState VarioMotor_GetState(void)
* @param	없음.
* @return	T_E_VarioMotorState	현재 진행하고있는 StateMachine 값
* @see		 현재 진행하고있는 StateMachine return
*/
T_E_VarioMotorState VarioMotor_GetState(void)
{
	return meVarioMotorState;
}

/**
* @fn T_E_VarioMotorRequest VarioMotor_GetCurRequest(void)
* 현재 Vario Request 상태
* @param		 없음
* @return	T_E_VarioMotorRequest		Vario Request 상태
* @see		없음.
*/
T_E_VarioMotorRequest VarioMotor_GetCurRequest(void)
{
	return meVarioMotorRequest;
}

/**
* @fn T_E_VarioStatus VarioMotor_GetCurVarioPosition(void)
* 현재 Vario 위치.
* @param			 없음
* @return	현재Vario 위치 값.
* @see		없음.
*/
T_E_VarioStatus VarioMotor_GetCurVarioPosition(void)
{
	return	meCurVarioPosition;
}
/**
* @fn T_E_VarioStatus VarioMotor_GetTarVarioPosition(void)
* Target Vario 위치.
* @param		 없음
* @return	Target Vario 위치 값.
* @see		없음.
*/
T_E_VarioStatus VarioMotor_GetTarVarioPosition(void)
{
	return	meTarVarioPosition;
}

/**
* @fn BOOL VarioMotor_IsComplete_FindBasePoint(void)
* 기준점 찾기 동작 완료 확인.
* @param		 없음
* @return	BOOL	기준점 찾기 동작완료시 TRUE, 미 완료 : FALSE.
* @see		없음.
*/
BOOL VarioMotor_IsComplete_FindBasePoint(void)
{
	return (VarioMotor_GetState() == VARIOMOTOR_STATE_COMPLETE_FIND_BASEPOINT);
}

/**
* @fn BOOL VarioMotor_IsComplete_MoveTargetPos(void)
* Target 이동 동작 완료 확인.
* @param		 없음
* @return	BOOL	Target 이동 동작완료시 TRUE, 미 완료 : FALSE.
* @see		없음.
*/
BOOL VarioMotor_IsComplete_MoveTargetPos(void)
{
	return (VarioMotor_GetState() == VARIOMOTOR_STATE_COMPLETE_MOVE_TARGETPOS);
}

/**
* @fn BOOL VarioMotor_IsFault_MoveTargetPos(void)
* Target 이동 동작 Fault 확인.
* @param		 없음
* @return	BOOL	Target 이동 동작 Fault시 TRUE, 아니면 : FALSE.
* @see		없음.
*/
BOOL VarioMotor_IsFault_MoveTargetPos(void)
{
	return (VarioMotor_GetState() == VARIOMOTOR_STATE_FINAL_ERROR);
}

/**
* @fn void VarioMotor_Init(void)
* VarioMotor 초기화 작업
* @param		 없음
* @return	없음
* @see		없음.
*/
void VarioMotor_Init(void)
{
	mb_IsOn = FALSE;
	VARIOMOTOR_PORT = FALSE;
}

/**
* @fn BOOL VarioMotor_IsOn(void)
* VarioMotor 상태 확인 함수
* @param		 없음
* @return	VarioMotor 상태
* @see		없음.
*/
BOOL VarioMotor_IsOn(void)
{
	return mb_IsOn;
}

/**
* @fn void VarioMotor_TurnOn(void)
* VarioMotor On 함수
* @param		 없음
* @return	없음
* @see		없음.
*/
void VarioMotor_TurnOn(void)
{
	VARIOMOTOR_PORT = TRUE;
	mb_IsOn = TRUE;
}

/**
* @fn void VarioMotor_TurnOff(void)
* VarioMotor Off 함수
* @param		 없음
* @return	없음
* @see		없음.
*/
void VarioMotor_TurnOff(void)
{
	VARIOMOTOR_PORT = FALSE;
	mb_IsOn = FALSE;
}

/**
* @fn T_E_VarioSWEdge VarioMotor_GetSwitchState(void)
* 현재 Vario Switch 상태
* @param		 없음
* @return	T_E_VarioSWEdge		Vario Switch 상태
* @see		없음.
*/
T_E_VarioSWEdge VarioMotor_GetSwitchState(void)
{
	return meVarioEdgeState;
}

/**
* @fn UINT8 VarioMotor_GetVarioSWCheckCount(void)
* 현재 Vario Switch 체크 상태
* @param	 없음
* @return	UINT8		Vario Switch 체크 상태
* @see		없음.
*/
UINT8 VarioMotor_GetVarioSWCheckCount(void)
{
	return mucVarioSWCheckCount;
}

/**
* @fn void VarioMotor_ClearVarioSWCheckCount(void)
* 현재 Vario Switch 체크 Clear 함수
* @param	 없음
* @return	없음
* @see		없음.
*/
void VarioMotor_ClearVarioSWCheckCount(void)
{
	mucVarioSWCheckCount = 0;
}

/**
* @fn void VarioMotor_SetFirstFindBasePointFlag(void)
* 최초 FindBasePoint 동작 여부 Flag 설정
* @param	 없음
* @return	없음
* @see		없음.
*/
void VarioMotor_SetFirstFindBasePointFlag(BOOL bVarioInitFlag)
{
	mbFirstVarioInitFlag = bVarioInitFlag;
}

/**
* @fn UINT8 VarioMotor_GetFirstVarioInitTime(void)
* 최초 Vario 초기화 동작시간 반환 함수
* @param	 없음
* @return	UINT8		mucFirstVarioInitTime
* @see		없음.
*/
UINT8 VarioMotor_GetFirstVarioInitTime(void)
{
	return mucFirstVarioInitTime;
}
