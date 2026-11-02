#include <string.h>
#include "../Common/Type.h"
#include "../Common/CommonConfig.h"
#include "./Device/RX130.h"
#include "../Driver/Driver.h"
#include "../Driver/DoorLatch.h"
#include "../Driver/DrainMotor_DC.h"
#include "../Driver/HeatDryHeater.h"
#include "../Driver/Sensor_DCLink.h"
#include "../Driver/Sensor_IPMTemperature.h"
#include "../Driver/SumpHeater.h"
#include "../Driver/SteamHeater.h"
#include "../Driver/Timer.h"
#include "../Driver/Uart.h"
#include "../Driver/WashMotor.h"
#include "CommInverter.h"


/* --------------- Define 정의  ---------------  */
#define COMM_SEND_TIME							(6)		// Data 송신 주기  - 60ms
/* 통신 에러 체크용 변수 */
#define	COMM_ERROR_CHECK_TIME					(40)	//(100ms Timer)

// Start & End of Frame data definition
#define START_OF_FRAME							(0x55)
#define END_OF_FRAME							(0x86)

// Receive State
#define REV_START_STATE							(0)
#define REV_DATA_STATE							(1)
#define REV_END_STATE							(2)

// Parsing Bit
#define PARSING_DRAIN_RELAYON_REQ_BIT			(0x04)
#define PARSING_WASH_INTERM_BIT					(0x01)
#define PARSING_WASH_LE_BIT						(0x02)
#define PARSING_WASH_RELAYON_REQ_BIT			(0x04)
#define PARSING_LATCHDOOR_BIT					(0x01)
#define PARSING_IPM_TEMP_CONTROL_BIT			(0x01)

/* --------------- Typedef형 정의  ---------------  */
// Main to Inverter Comm Tx Index
typedef enum
{
	START_INVCOMM_T_IDX = 0,
	DRAIN_CCW_BIS_FLAG_INVCOMM_T_IDX,
	DRAIN_TARGET_RPM_LOW_INVCOMM_T_IDX,
	DRAIN_TARGET_RPM_HIGH_INVCOMM_T_IDX,
	WASH_BIS_FLAG_INVCOMM_T_IDX,
	WASH_TARGET_RPM_LOW_INVCOMM_T_IDX,
	WASH_TARGET_RPM_HIGH_INVCOMM_T_IDX,
	DOOR_N_HEATER_FLAG_INVCOMM_T_IDX,
	INV_FOTA_FLAG_IDX,
	RESERVED_T_IDX0,
	RESERVED_T_IDX1,
	RESERVED_T_IDX2,
	RESERVED_T_IDX3,
	RESERVED_T_IDX4,
	RESERVED_T_IDX5,
	RESERVED_T_IDX6,
	RESERVED_T_IDX7,
	RESERVED_T_IDX8,
	CRC_LOW_INVCOMM_T_IDX,
	CRC_HIGH_INVCOMM_T_IDX,
	END_INVCOMM_T_IDX,
	INV_COMM_MAX_T_SIZE,
} T_E_MainToInvCommTxIndex;

// Inverter to Main Comm Rx Index
typedef enum
{
	START_INVCOMM_R_IDX = 0,
	DRAIN_RELAYON_REQ_R_IDX,
	DRAIN_CURRENT_RPM_LOW_INVCOMM_R_IDX,
	DRAIN_CURRENT_RPM_HIGH_INVCOMM_R_IDX,
	DRAIN_REQUEST_RPM_LOW_INVCOMM_R_IDX,
	DRAIN_REQUEST_RPM_HIGH_INVCOMM_R_IDX,
	DRAIN_MOTOR_CURRENT_LOW_INVCOMM_R_IDX,
	DRAIN_MOTOR_CURRENT_HIGH_INVCOMM_R_IDX,
	DRAIN_MOTOR_WATT_LOW_INVCOMM_R_IDX,
	DRAIN_MOTOR_WATT_HIGH_INVCOMM_R_IDX,
	WASH_RELAYONREQ_INTERM_LE_INVCOMM_R_IDX,
	WASH_CURRENT_RPM_LOW_INVCOMM_R_IDX,
	WASH_CURRENT_RPM_HIGH_INVCOMM_R_IDX,
	WASH_REQUEST_RPM_LOW_INVCOMM_R_IDX,
	WASH_REQUEST_RPM_HIGH_INVCOMM_R_IDX,
	WASH_MOTOR_CURRENT_LOW_INVCOMM_R_IDX,
	WASH_MOTOR_CURRENT_HIGH_INVCOMM_R_IDX,
	WASH_MOTOR_WATT_LOW_INVCOMM_R_IDX,
	WASH_MOTOR_WATT_HIGH_INVCOMM_R_IDX,
	DOOR_OPEN_FLAG_INVCOMM_R_IDX,
	DCLINK_VOLT_INVCOMM_R_IDX,
	IPM_TEMP_INVCOMM_R_IDX,
	IPM_TEMP_CONTROL_INVCOMM_R_IDX,
	BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX,
	BLACKBOX_MOTOR_MORNITORING_HIGH_R_IDX,
	DCLINK_AD_VALUE_LOW_MAINCOMM_R_IDX,
	DCLINK_AD_VALUE_HIGH_MAINCOMMM_R_IDX,
	INVERTER_VERSION_R_IDX,
	SAFETY_CRC_LOW_R_IDX,
	SAFETY_CRC_HIGH_R_IDX,
	CHECKSUM_LOW_R_IDX,
	CHECKSUM_HIGH_R_IDX,
	SWPARTNUMBER_0_R_IDX,
	SWPARTNUMBER_1_R_IDX,
	SWPARTNUMBER_2_R_IDX,
	SWPARTNUMBER_3_R_IDX,
	RESERVED_R_IDX0,
	RESERVED_R_IDX1,
	RESERVED_R_IDX2,
	RESERVED_R_IDX3,
	RESERVED_R_IDX4,
	RESERVED_R_IDX5,
	RESERVED_R_IDX6,
	RESERVED_R_IDX7,
	RESERVED_R_IDX8,
	RESERVED_R_IDX9,
	RESERVED_R_IDX10,
	CRC_LOW_INVCOMM_R_IDX,
	CRC_HIGH_INVCOMM_R_IDX,
	END_COMM_R_IDX,
	INV_COMM_R_MAX_SIZE,
} T_E_InvToMainCommRxIndex;


/* --------------- 상수 정의  ---------------  */
static const UINT16 crc_16_ccitt_table[256] =
{
	0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50A5, 0x60C6, 0x70E7,
	0x8108, 0x9129, 0xA14A, 0xB16B, 0xC18C, 0xD1AD, 0xE1CE, 0xF1EF,
	0x1231, 0x0210, 0x3273, 0x2252, 0x52B5, 0x4294, 0x72F7, 0x62D6,
	0x9339, 0x8318, 0xB37B, 0xA35A, 0xD3BD, 0xC39C, 0xF3FF, 0xE3DE,
	0x2462, 0x3443, 0x0420, 0x1401, 0x64E6, 0x74C7, 0x44A4, 0x5485,
	0xA56A, 0xB54B, 0x8528, 0x9509, 0xE5EE, 0xF5CF, 0xC5AC, 0xD58D,
	0x3653, 0x2672, 0x1611, 0x0630, 0x76D7, 0x66F6, 0x5695, 0x46B4,
	0xB75B, 0xA77A, 0x9719, 0x8738, 0xF7DF, 0xE7FE, 0xD79D, 0xC7BC,
	0x48C4, 0x58E5, 0x6886, 0x78A7, 0x0840, 0x1861, 0x2802, 0x3823,
	0xC9CC, 0xD9ED, 0xE98E, 0xF9AF, 0x8948, 0x9969, 0xA90A, 0xB92B,
	0x5AF5, 0x4AD4, 0x7AB7, 0x6A96, 0x1A71, 0x0A50, 0x3A33, 0x2A12,
	0xDBFD, 0xCBDC, 0xFBBF, 0xEB9E, 0x9B79, 0x8B58, 0xBB3B, 0xAB1A,
	0x6CA6, 0x7C87, 0x4CE4, 0x5CC5, 0x2C22, 0x3C03, 0x0C60, 0x1C41,
	0xEDAE, 0xFD8F, 0xCDEC, 0xDDCD, 0xAD2A, 0xBD0B, 0x8D68, 0x9D49,
	0x7E97, 0x6EB6, 0x5ED5, 0x4EF4, 0x3E13, 0x2E32, 0x1E51, 0x0E70,
	0xFF9F, 0xEFBE, 0xDFDD, 0xCFFC, 0xBF1B, 0xAF3A, 0x9F59, 0x8F78,
	0x9188, 0x81A9, 0xB1CA, 0xA1EB, 0xD10C, 0xC12D, 0xF14E, 0xE16F,
	0x1080, 0x00A1, 0x30C2, 0x20E3, 0x5004, 0x4025, 0x7046, 0x6067,
	0x83B9, 0x9398, 0xA3FB, 0xB3DA, 0xC33D, 0xD31C, 0xE37F, 0xF35E,
	0x02B1, 0x1290, 0x22F3, 0x32D2, 0x4235, 0x5214, 0x6277, 0x7256,
	0xB5EA, 0xA5CB, 0x95A8, 0x8589, 0xF56E, 0xE54F, 0xD52C, 0xC50D,
	0x34E2, 0x24C3, 0x14A0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
	0xA7DB, 0xB7FA, 0x8799, 0x97B8, 0xE75F, 0xF77E, 0xC71D, 0xD73C,
	0x26D3, 0x36F2, 0x0691, 0x16B0, 0x6657, 0x7676, 0x4615, 0x5634,
	0xD94C, 0xC96D, 0xF90E, 0xE92F, 0x99C8, 0x89E9, 0xB98A, 0xA9AB,
	0x5844, 0x4865, 0x7806, 0x6827, 0x18C0, 0x08E1, 0x3882, 0x28A3,
	0xCB7D, 0xDB5C, 0xEB3F, 0xFB1E, 0x8BF9, 0x9BD8, 0xABBB, 0xBB9A,
	0x4A75, 0x5A54, 0x6A37, 0x7A16, 0x0AF1, 0x1AD0, 0x2AB3, 0x3A92,
	0xFD2E, 0xED0F, 0xDD6C, 0xCD4D, 0xBDAA, 0xAD8B, 0x9DE8, 0x8DC9,
	0x7C26, 0x6C07, 0x5C64, 0x4C45, 0x3CA2, 0x2C83, 0x1CE0, 0x0CC1,
	0xEF1F, 0xFF3E, 0xCF5D, 0xDF7C, 0xAF9B, 0xBFBA, 0x8FD9, 0x9FF8,
	0x6E17, 0x7E36, 0x4E55, 0x5E74, 0x2E93, 0x3EB2, 0x0ED1, 0x1EF0,
};

/* --------------- 전역 변수 정의  ---------------  */
static UINT8 mucErrorCheckTimer = COMM_ERROR_CHECK_TIME;
static BOOL mbDrainOperatingFail_Flag;
static BOOL mbMotorPowerLineFail_Flag;

static UINT8 mucSendTimer;						/* 데이터 송신 주기 체크용 변수 */

static UINT8 maucCommRecBuffer[INV_COMM_R_MAX_SIZE];
static UINT8 maucCommRecTempBuffer[INV_COMM_R_MAX_SIZE];

static UINT8 maucCommTransBuffer[INV_COMM_MAX_T_SIZE];
static UINT8 mucINVRecDataIdx = 0;
static UINT8 mucINVTransDataIdx = 0;

static UINT16 munComm_DataID_Number;
static BOOL mbInverterFOTAFlag = FALSE;
static T_Time mstTimer_Comm_WashMotorOffDelay;
static BOOL mbClearLEFlag;

static UINT16 maunBlackBoxMotorData[BLACKBOX_MOTOR_MAX];


/* --------------- 함수 원형 정의  ---------------  */
static UINT8 _Comm_CheckCRC(void);
static UINT8 _Comm_DataReceive(void);
static void _Comm_ParsingRevData(void);
static void _Comm_DataID_Inc(void);
static UINT16 _CRCMaker_CRC16_CCITT(UINT8 *pucBuffer, UINT8 ucLength);
static void _IncreaseMotorMonitoringData(UINT8 ucIndex);

/**
* @fn void Comm_ISR_Timer_10ms_DecTimer(void)
* Uart Timer 구동 함수, 10ms Interrupt에서 호출
* @param	없음
* @return	없음
* @see		없음
*/
void Comm_ISR_Timer_10ms_DecTimer(void)
{
	if (mucSendTimer > 0)
	{
		mucSendTimer--;
	}
	else
	{
		;	///< Do nothing
	}
}

/**
* @fn void Comm_Set_INVSendTimer(void)
* Main <--> INV 통신 주기 설정하는 함수
* @param	없음
* @return	없음
* @see		없음
*/
void Comm_Set_INVSendTimer(void)
{
	mucSendTimer = COMM_SEND_TIME;
}

/**
* @fn UINT8 Comm_Get_INVSendTimer(void)
* Uart 통신 주기 설정된 값 Return 하는 함수
* @param	없음
* @return	mucSendTimer		Uart 통신 주기
* @see		없음
*/
UINT8 Comm_Get_INVSendTimer(void)
{
	return mucSendTimer;
}


/**
* @fn BOOL ReturnError(T_E_Error e_Error)
* 확인하고자 하는 Error Return 하는 함수
* @param	Error 종류
* @return	입력 받은 Error와 현재 Error가 동일시 True
* @see		없음
*/
BOOL ReturnError(T_E_Error eError)
{
	T_Context* pstContext = CommonConfig_Get_Context();
	BOOL bReturn = FALSE;

	if (pstContext->eError == eError)
	{
		bReturn = TRUE;
	}
	else
	{
		;
	}

	return bReturn;
}

/**
* @fn void Comm_Set_SendINVData(void)
* Main -> Inverter로 전달할 데이터 설정
* @param	없음
* @return	없음
* @see
*/
void Comm_Set_SendINVData(void)
{
	UINT16 TempData16 = 0;
	static BOOL bDrainMotor_IsOn;
	static BOOL bWashMotor_IsOn;

	if(Timer_MsecCheckPassTime(&mstTimer_Comm_WashMotorOffDelay, 100, NONE) == TRUE)
	{
		bDrainMotor_IsOn = DrainMotor_DC_IsOn();
		bWashMotor_IsOn = WashMotor_IsOn();
	}
	else
	{
		;
	}

	maucCommTransBuffer[START_INVCOMM_T_IDX] = START_OF_FRAME;
	maucCommTransBuffer[DRAIN_CCW_BIS_FLAG_INVCOMM_T_IDX] = (((UINT8)ReturnError(ERROR_F11) << 2U) | ((UINT8)bDrainMotor_IsOn << 1U) | ((UINT8)DrainMotor_DC_IsDirectionCCW()));
	maucCommTransBuffer[DRAIN_TARGET_RPM_LOW_INVCOMM_T_IDX] = (UINT8)(DrainMotor_DC_GetTarRPM() & 0x00FFU);
	maucCommTransBuffer[DRAIN_TARGET_RPM_HIGH_INVCOMM_T_IDX] = (UINT8)((DrainMotor_DC_GetTarRPM() & 0xFF00U) >> 8U);
	maucCommTransBuffer[WASH_BIS_FLAG_INVCOMM_T_IDX] = ((((UINT8)ReturnError(ERROR_F21) || mbClearLEFlag) << 3U) | ((UINT8)bWashMotor_IsOn << 1U));
	mbClearLEFlag = FALSE;
	maucCommTransBuffer[WASH_TARGET_RPM_LOW_INVCOMM_T_IDX] = (UINT8)(WashMotor_GetTarRPM() & 0x00FFU);
	maucCommTransBuffer[WASH_TARGET_RPM_HIGH_INVCOMM_T_IDX] = (UINT8)((WashMotor_GetTarRPM() & 0xFF00U) >> 8U);
	maucCommTransBuffer[DOOR_N_HEATER_FLAG_INVCOMM_T_IDX] = ((UINT8)SteamHeater_IsOn() << 3U | (UINT8)HeatDryHeater_IsOn() << 2U | ((UINT8)SumpHeater_IsOn() << 1U) | ((UINT8)DoorLatch_IsOpen()));
	maucCommTransBuffer[INV_FOTA_FLAG_IDX] = (UINT8)(mbInverterFOTAFlag & 0x01);
	//Set CRC
	TempData16 = _CRCMaker_CRC16_CCITT(&maucCommTransBuffer[START_INVCOMM_T_IDX], CRC_LOW_INVCOMM_T_IDX);
	maucCommTransBuffer[CRC_LOW_INVCOMM_T_IDX] = (UINT8)(TempData16 & 0x00FFU);
	maucCommTransBuffer[CRC_HIGH_INVCOMM_T_IDX] = (UINT8)((TempData16 & 0xFF00U) >> 8U);

	maucCommTransBuffer[END_INVCOMM_T_IDX] = END_OF_FRAME;
}

void Comm_Send_INVData(void)
{

	if (Comm_Get_INVSendTimer() <= 0)
	{
		// Timer Set
		Comm_Set_INVSendTimer();

		// Set Recive Data
		Comm_Receive_INVData();

		// Data Set
		Comm_Set_SendINVData();

		// Data Transmit
		mucINVTransDataIdx = 1;
		Comm_Transmit_INVData(maucCommTransBuffer[0]);
	}
	else
	{
		; ///< Do nothing
	}
}

void Comm_Transmit_INVData(UINT8 ucValue)
{
	SCI5.TDR = ucValue;
}

void Comm_ISR_INV_GetReceiveData(void)
{
#ifndef __SILS__
	if (mucINVRecDataIdx < INV_COMM_R_MAX_SIZE)
	{
		maucCommRecTempBuffer[mucINVRecDataIdx] = _Comm_DataReceive();
		mucINVRecDataIdx++;
	}
	else
	{
		;	///< Do nothing
	}
#endif
}

void Comm_ISR_Sending_INVData(void)
{
	if (mucINVTransDataIdx < INV_COMM_MAX_T_SIZE)
	{
		Comm_Transmit_INVData(maucCommTransBuffer[mucINVTransDataIdx]);
		mucINVTransDataIdx++;

		if (mucINVTransDataIdx == INV_COMM_MAX_T_SIZE)
		{
			_Comm_DataReceive();							 // Read Receive Buffer
			SCI5.SSR.BYTE = ((SCI5.SSR.BYTE & 0xC4) | 0xC0); // Overrun Error Clear, Framing Error Clear, Parity Error Clear
		}
		else
		{
			; ///< Do nothing
		}
	}
}

/**
* @fn void Comm_Receive_INVData(void)
* Inverter -> Main로 전달된 데이터를 프로토콜에 맞춰 Buffer에 저장
* @param	없음
* @return	없음
* @see
*/
void Comm_Receive_INVData(void)
{
#ifdef __SILS__
#define	INVERTER_VERSION		(1)
#define SW_PART_NUMBER			(30458401)		// Main SW Part Number : SAA44633101
#define CHECKSUM_VALUE			(0xD3B2)		// CheckSum

	maucCommRecTempBuffer[IPM_TEMP_INVCOMM_R_IDX]		= Sensor_IPMTemperature_GetTemp_SSLS();
	maucCommRecTempBuffer[INVERTER_VERSION_R_IDX]		= INVERTER_VERSION;
	maucCommRecTempBuffer[CHECKSUM_LOW_R_IDX]			= (UINT8)(CHECKSUM_VALUE & 0x00FF);
	maucCommRecTempBuffer[CHECKSUM_HIGH_R_IDX]			= (UINT8)((CHECKSUM_VALUE & 0xFF00) >> 8);
	maucCommRecTempBuffer[SWPARTNUMBER_0_R_IDX]			= (UINT8)(SW_PART_NUMBER & 0x000000FF);
	maucCommRecTempBuffer[SWPARTNUMBER_1_R_IDX]			= (UINT8)((SW_PART_NUMBER & 0xFF000000) >> 8);
	maucCommRecTempBuffer[SWPARTNUMBER_2_R_IDX]			= (UINT8)((SW_PART_NUMBER & 0xFF000000) >> 16);
	maucCommRecTempBuffer[SWPARTNUMBER_3_R_IDX]			= (UINT8)((SW_PART_NUMBER & 0xFF000000) >> 24);
#endif

#ifndef __SILS__
	if(_Comm_CheckCRC() == TRUE) // Checksum이 정상일 경우
	{
#endif
		memcpy(maucCommRecBuffer, maucCommRecTempBuffer, INV_COMM_R_MAX_SIZE);

		_Comm_ParsingRevData();

		_Comm_DataID_Inc();

		// 통신 Error Timer 리셋
		Comm_SetErrorCheckTimer();
#ifndef __SILS__
	}
	else
	{
		;
	}
#endif

	mucINVRecDataIdx = 0;
}

static void _Comm_DataID_Inc(void)
{
	munComm_DataID_Number++;
}

UINT16 Comm_Get_DataID(void)
{
	return munComm_DataID_Number;
}

/**
* @fn UINT8 Comm_GetTxDataNum(void)
* Tx Data의 현재 Index를 전달.
* @param	없음
* @return	mucINVTransDataIdx     Tx Data의 현재 Index값
* @see
*/
UINT8 Comm_GetTxDataNum(void)
{
	return mucINVTransDataIdx;
}

/**
* @fn static UINT8 _Comm_DataReceive(void)
* Inverter -> Main로 전달된 데이터를 수신
* @param	없음
* @return	없음
* @see
*/
static UINT8 _Comm_DataReceive(void)
{
	return SCI5.RDR;
}

/**
* @fn static UINT8 _Comm_CheckCRC(void)
* Inverter -> Main로 전달된 데이터의 CRC를 구하고, 수신한 CRC와 비교하여 데이터가 정상인지 확인
* @param	없음
* @return	1: CRC 정상, 0: CRC 에러
* @see
*/
static UINT8 _Comm_CheckCRC(void)
{
	UINT16 CrcVal = 0;
	UINT8 RetVal = FALSE;

	CrcVal = _CRCMaker_CRC16_CCITT(&maucCommRecTempBuffer[START_INVCOMM_R_IDX], CRC_LOW_INVCOMM_R_IDX);

	if ((maucCommRecTempBuffer[START_INVCOMM_R_IDX] == START_OF_FRAME) &&
		(maucCommRecTempBuffer[END_COMM_R_IDX] == END_OF_FRAME) &&
		(maucCommRecTempBuffer[CRC_LOW_INVCOMM_R_IDX] == LOBYTE(CrcVal)) &&
		(maucCommRecTempBuffer[CRC_HIGH_INVCOMM_R_IDX] == HIBYTE(CrcVal))
		)
	{
		RetVal = TRUE;	// Checksum이 정상일 경우 TRUE를 Return한다.

		maucCommRecTempBuffer[START_INVCOMM_R_IDX] = 0;
		maucCommRecTempBuffer[END_COMM_R_IDX] = 0;
	}
	else
	{
		;
	}

	return RetVal;
}

/**
* @fn static void _Comm_ParsingRevData(void)
* Inverter -> Main로 전달된 데이터를 Parsing하여 해당 정보에 설정.
* @param	없음
* @return	없음
* @see
*/
static void _Comm_ParsingRevData(void)
{
	UINT16 TempData16 = 0;
	UINT8 TempData8 = 0;
	T_Context* pstContext = CommonConfig_Get_Context();

	// Set DrainMotor Current RPM
	TempData16 = (((UINT16)maucCommRecBuffer[DRAIN_CURRENT_RPM_HIGH_INVCOMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[DRAIN_CURRENT_RPM_LOW_INVCOMM_R_IDX]);
	DrainMotor_DC_SetCurRPM(TempData16);

	// Set DrainMotor Request RPM
	TempData16 = (((UINT16)maucCommRecBuffer[DRAIN_REQUEST_RPM_HIGH_INVCOMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[DRAIN_REQUEST_RPM_LOW_INVCOMM_R_IDX]);
	DrainMotor_DC_SetRequestRPM(TempData16);

	// Set DrainMotor Current
	TempData16 = (((UINT16)maucCommRecBuffer[DRAIN_MOTOR_CURRENT_HIGH_INVCOMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[DRAIN_MOTOR_CURRENT_LOW_INVCOMM_R_IDX]);
	DrainMotor_DC_SetMotorCurrent(TempData16);

	// Set DrainMotor Watt
	TempData16 = (((UINT16)maucCommRecBuffer[DRAIN_MOTOR_WATT_HIGH_INVCOMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[DRAIN_MOTOR_WATT_LOW_INVCOMM_R_IDX]);
	DrainMotor_DC_SetMotorWatt(TempData16);

	// Set Wash Intermit
	if ((maucCommRecBuffer[WASH_RELAYONREQ_INTERM_LE_INVCOMM_R_IDX] & PARSING_WASH_INTERM_BIT) == PARSING_WASH_INTERM_BIT)
	{
		WashMotor_SetIntermitWashFlag();
	}
	else
	{
		WashMotor_SetNormalWashFlag();
	}

	// Set Wash LE
	if ((maucCommRecBuffer[WASH_RELAYONREQ_INTERM_LE_INVCOMM_R_IDX] & PARSING_WASH_LE_BIT) == PARSING_WASH_LE_BIT)
	{
		WashMotor_SetLEFlag();
	}
	else
	{
		;
	}

	// Set WashMotor Current RPM
	TempData16 = (((UINT16)maucCommRecBuffer[WASH_CURRENT_RPM_HIGH_INVCOMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[WASH_CURRENT_RPM_LOW_INVCOMM_R_IDX]);
	WashMotor_SetCurRPM(TempData16);

	// Set WashMotor Request RPM
	TempData16 = (((UINT16)maucCommRecBuffer[WASH_REQUEST_RPM_HIGH_INVCOMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[WASH_REQUEST_RPM_LOW_INVCOMM_R_IDX]);
	WashMotor_SetRequestRPM(TempData16);

	// Set WashMotor Current
	TempData16 = (((UINT16)maucCommRecBuffer[WASH_MOTOR_CURRENT_HIGH_INVCOMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[WASH_MOTOR_CURRENT_LOW_INVCOMM_R_IDX]);
	WashMotor_SetMotorCurrent(TempData16);

	// Set WashMotor Watt
	TempData16 = (((UINT16)maucCommRecBuffer[WASH_MOTOR_WATT_HIGH_INVCOMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[WASH_MOTOR_WATT_LOW_INVCOMM_R_IDX]);
	WashMotor_SetMotorWatt(TempData16);

	// Set IPM Temp
	TempData8 = maucCommRecBuffer[IPM_TEMP_INVCOMM_R_IDX];
	Sensor_IPMTemperature_SetValue(TempData8);

	// IPM 보호모드
	if ((maucCommRecBuffer[IPM_TEMP_CONTROL_INVCOMM_R_IDX] & PARSING_IPM_TEMP_CONTROL_BIT) == PARSING_IPM_TEMP_CONTROL_BIT)
	{
		SumpHeater_SetIPMTempControl();
	}
	else
	{
		SumpHeater_ClearIPMTempControl();
	}

	// BlackBox Motor Monitoring
	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX] & (0x01 << BLACKBOX_MOTOR_DRAIN_LOCK_COUNT)) == (0x01 << BLACKBOX_MOTOR_DRAIN_LOCK_COUNT))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_DRAIN_LOCK_COUNT);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX] & (0x01 << BLACKBOX_MOTOR_WASH_LOCK_COUNT)) == (0x01 << BLACKBOX_MOTOR_WASH_LOCK_COUNT))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_WASH_LOCK_COUNT);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX] & (0x01 << BLACKBOX_MOTOR_ANGLE_ERROR_COUNT)) == (0x01 << BLACKBOX_MOTOR_ANGLE_ERROR_COUNT))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_ANGLE_ERROR_COUNT);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX] & (0x01 << BLACKBOX_MOTOR_SPEED_ERROR_COUNT)) == (0x01 << BLACKBOX_MOTOR_SPEED_ERROR_COUNT))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_SPEED_ERROR_COUNT);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX] & (0x01 << BLACKBOX_MOTOR_HW_CURRENT_LIMIT_COUNT)) == (0x01 << BLACKBOX_MOTOR_HW_CURRENT_LIMIT_COUNT))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_HW_CURRENT_LIMIT_COUNT);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX] & (0x01 << BLACKBOX_MOTOR_SW_CURRENT_LIMIT_COUNT)) == (0x01 << BLACKBOX_MOTOR_SW_CURRENT_LIMIT_COUNT))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_SW_CURRENT_LIMIT_COUNT);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX] & (0x01 << BLACKBOX_MOTOR_FO_COUNT)) == (0x01 << BLACKBOX_MOTOR_FO_COUNT))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_FO_COUNT);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_LOW_R_IDX] & (0x01 << BLACKBOX_MOTOR_DRAIN_OUT_OF_PHASE)) == (0x01 << BLACKBOX_MOTOR_DRAIN_OUT_OF_PHASE))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_DRAIN_OUT_OF_PHASE);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_HIGH_R_IDX] & (0x01 << (BLACKBOX_MOTOR_RUN_COUNT - 8))) == (0x01 << (BLACKBOX_MOTOR_RUN_COUNT - 8)))
	{
		_IncreaseMotorMonitoringData(BLACKBOX_MOTOR_RUN_COUNT);
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_HIGH_R_IDX] & (0x01 << (SMART_DRAIONOPERATINGFAIL - 8))) == (0x01 << (SMART_DRAIONOPERATINGFAIL - 8)))	// 9번 비트를 DraionOperatingFailFlag로 사용
	{
		mbDrainOperatingFail_Flag = SET;
	}

	if ((maucCommRecBuffer[BLACKBOX_MOTOR_MORNITORING_HIGH_R_IDX] & (0x01 << (SMART_MOTORPOWERLINEFAIL - 8))) == (0x01 << (SMART_MOTORPOWERLINEFAIL - 8)))		// 10번 비트를  mbSmart_MotorPowerLineFail_Flag 사용
	{
		mbMotorPowerLineFail_Flag = SET;
	}

	// Set DClink AD Value
	TempData16 = (((UINT16)maucCommRecBuffer[DCLINK_AD_VALUE_HIGH_MAINCOMMM_R_IDX] << 8) | (UINT16)maucCommRecBuffer[DCLINK_AD_VALUE_LOW_MAINCOMM_R_IDX]);
	Set_DCLink_AD_Value(TempData16);


	// Set SW Info
	pstContext->ulInverterSWPartNumber = 	(UINT32)maucCommRecBuffer[SWPARTNUMBER_0_R_IDX] +
											(UINT32)maucCommRecBuffer[SWPARTNUMBER_1_R_IDX] * 100 +
											(UINT32)maucCommRecBuffer[SWPARTNUMBER_2_R_IDX] * 10000 +
											(UINT32)maucCommRecBuffer[SWPARTNUMBER_3_R_IDX] * 1000000;
	pstContext->unInverterSWCheckSum = (UINT16)maucCommRecBuffer[CHECKSUM_HIGH_R_IDX] << 8 | (UINT16)maucCommRecBuffer[CHECKSUM_LOW_R_IDX];
	pstContext->unInverterSWCRC = (UINT16)maucCommRecBuffer[SAFETY_CRC_HIGH_R_IDX] << 8 | (UINT16)maucCommRecBuffer[SAFETY_CRC_LOW_R_IDX];
	pstContext->ucInverterSWVersion = maucCommRecBuffer[INVERTER_VERSION_R_IDX];
}

static UINT16 _CRCMaker_CRC16_CCITT(UINT8 *pucBuffer, UINT8 ucLength)
{
	UINT32 i = 0;
	UINT16 crc = 0;

	for (i = 0; i < ucLength; i++)
	{
		crc = (crc << 8) ^ crc_16_ccitt_table[((crc >> 8) ^ *pucBuffer++) & 0x00FF];
		crc = crc ^ ((UINT16)(*pucBuffer) << 8);
	}

	return crc;
}

/*
* @fn void _IncreaseMotorMonitoringData(UINT8)
* Motor Data Increase
* @param	Motor Data Enum
* @return	없음
*/
static void _IncreaseMotorMonitoringData(UINT8 ucIndex)
{
	if(ucIndex == BLACKBOX_MOTOR_RUN_COUNT)
	{
		if(maunBlackBoxMotorData[ucIndex] == 0xffff)
		{
			;	// Do Nothing
		}
		else
		{
			maunBlackBoxMotorData[ucIndex]++;
		}
	}
	else
	{
		if(maunBlackBoxMotorData[ucIndex] == 0xff)
		{
			;	// Do Nothing
		}
		else
		{
			maunBlackBoxMotorData[ucIndex]++;
		}
	}
}

/**
 * @fn Comm_Error_Check_Timer_100ms_IncTimer(void)
 * 메인<->인버터 마이컴간 통신 Error시간 체크 함수
 * @param	없음
 * @return	없음
 * @see		없음
 */
void Comm_Error_Check_Timer_100ms_IncTimer(void)
{
	if (mucErrorCheckTimer < COMM_ERROR_CHECK_TIME)
	{
		mucErrorCheckTimer++;

		if (mucErrorCheckTimer > 20)
		{
			INV_15V_START_PORT = OFF;
		}
		else
		{
			;
		}
	}
	else
	{
		mucErrorCheckTimer = 0;
		INV_15V_START_PORT = ON;
	}
}

/**
 * @fn void Comm_SetErrorCheckTimer(void)
 * 통신 Error Check 주기 설정하는 함수
 * @param	없음
 * @return	없음
 * @see		없음
 */
void Comm_SetErrorCheckTimer(void)
{
	mucErrorCheckTimer = COMM_ERROR_CHECK_TIME;
}

BOOL Comm_Get_Smart_DrainOpeartingFlag(void)
{
	return mbDrainOperatingFail_Flag;
}

BOOL Comm_Get_Smart_MotorPowerLineFlag(void)
{
	return mbMotorPowerLineFail_Flag;
}

void Comm_Set_InverterFOTA(void)
{
	mbInverterFOTAFlag = SET;
}

void Driver_CommInverter_Set_WashMotorOffDelay(void)
{
	Timer_GetTime(&mstTimer_Comm_WashMotorOffDelay);
}

UINT16 Comm_Get_MotorMonitoringData(T_E_BlackBoxMotorData eMotorData)
{
	return maunBlackBoxMotorData[eMotorData];
}

void Comm_Clear_MotorMonitoringData(void)
{
	memset(maunBlackBoxMotorData, 0, sizeof(maunBlackBoxMotorData));
}

void Comm_Clear_WashMotor_LEFlag(void)
{
	mbClearLEFlag = TRUE;
}

#ifdef __SILS__
//******************** SILS SSLSMotor.h ********************//
#define Q8			  256
#define Q9			  512
#define Q10			 1024
#define Q11			 2048
#define Q12			 4096
#define Q13			 8192
#define Q14			16384
#define Q15			32768
#define Q16			65536

/**
 * Sensorless VectorControl를 위한 구조체
 */
typedef enum
{
	MOTORSTEP_STOP = 0,
	MOTORSTEP_OFFSET_MEASURE,
	MOTORSTEP_BOOTSTRAP,
	MOTORSTEP_RUNNING,
	MOTORSTEP_RELAY_SELECT,
	MOTORSTEP_RELAY_DELAY,
	MOTORSTEP_MOTOR_SELECT,
	MOTORSTEP_ALIGN_START,
	MOTORSTEP_ALIGN_MEASURE,
	MOTORSTEP_ALIGN_STOP,
	MOTORSTEP_MAX
} T_E_MOTORSTEP;

typedef enum
{
	DRAIN_MOTOR = 0,
	WASH_MOTOR
} T_E_MOTORTYPE;


//******************** SILS SSLSMotor.c ********************//
#define RELAY_DELAYTIME							7500
#define RELAY_OFFTIME							30000
#define	IPM_UPPERLIMIT_TEMP						(100)
#define IPM_MOTOR_STOP_TIME_SEC					30
#define SSLSMOROR_WASH_IF_SLOPE_100RPM_COUNT	3
#define	SSLSMOTOR_RUN_MINRPM					(900)				// 최소 모터 동작 RPM
#define	SSLSMOTOR_DRAIN_RUN_MAXRPM				(3200)				// 배수펌프 최고 동작 RPM

// SILS SumpHeater
static BOOL mb_IsIPMTempControl_SSLS;

// SILS SSLS TIMER
static BOOL mbTime_RpmSlope_TimerControl_F;		//SLESS

// SILS SSLS REGULARCONTROL
static UINT16 munTargetRpm;						//목표 rpm
static BOOL	mbMOTOR_START_F;
static BOOL	mbMOTOR_START_F_Pre;
static T_E_MOTORTYPE meMotorType;
static BOOL	mbMotorDirection;
static UINT16 munCurrentRPM;					//현재 RPM
static UINT16 munRequestRpm;					//지령 rpm
static BOOL mbTime_RpmSlope_RegularControl_F;
static UINT16 munRpmSlope_Inc;					// 100ms rpm 기울기
static BOOL	mbWashMotorIntermit;
static BOOL mbMotorRegularStart_F;
static BOOL mbMotorRegularStop_F;
static BOOL mbMotorRegularControl_F;

// SILS SSLS INTERRUPTCONTROL
static UINT16 munBootstrap_Cntr, munICalib_Cntr;
static UINT16 munRelay_select_Cntr, munRelay_Off_Time;
static BOOL mbMotor_Direction;
static T_E_MOTORSTEP meMotorControlStep;
static T_E_MOTORTYPE meControlMotor;
static T_E_MOTORTYPE mePrevControlMotor;
static UINT32 mulAlignCount;
static UINT8 mucWashMotor_IF_Count;


// SILS SSLS INTERRUPTCONTROL
void VC_MotorDrive_Init(void)
{
	munICalib_Cntr = 1024;

	// Align
	mulAlignCount = 0;

	if(meControlMotor == WASH_MOTOR)
	{
		mucWashMotor_IF_Count++;
	}
	else
	{
		mucWashMotor_IF_Count = 0;
	}
}

void VC_Get_Iabcs_Offset(void)
{
	if(munICalib_Cntr > 0)
	{
		munICalib_Cntr--;
	}
	else
	{
		munBootstrap_Cntr = 1500;	//0.1sec = 1500 , 1sec = 15000
		meMotorControlStep = MOTORSTEP_BOOTSTRAP;
	}
}

void VC_INT_PWM0(void)
{
	INT32 lRequest_Temp = 0;
	INT32 lMode_Change_RPM = 0;

	if(mbMotorRegularControl_F == FALSE)
	{
		if(mbMotorRegularStop_F == TRUE)														// Regular에서 정지 명령시 모터 상태를 정지로 변경
		{
			meMotorControlStep = MOTORSTEP_STOP;
		}
		else if((mbMotorRegularStart_F == TRUE) && (meMotorControlStep == MOTORSTEP_STOP))		// Regular에서 동작 명령시 정지 상태이면 기동 시작, 그 이외이면 유지(Regular 시작시 Flag는 해제됨)
		{
			meMotorControlStep = MOTORSTEP_MOTOR_SELECT;
		}
		else
		{
			;		///< Do nothing
		}
	}
	else
	{
		;		///< Do nothing
	}

	if(meMotorControlStep == MOTORSTEP_MOTOR_SELECT)
	{
		mePrevControlMotor = meControlMotor;
		meControlMotor = meMotorType;						// CCW(1, 정방향 ) , CW(0, 역방향)
		mbMotor_Direction = mbMotorDirection;
		VC_MotorDrive_Init();
		meMotorControlStep = MOTORSTEP_RELAY_SELECT;
	}
	else if(meMotorControlStep == MOTORSTEP_RELAY_SELECT)
	{
		if((mePrevControlMotor != meControlMotor) && (munRelay_Off_Time > 0))
		{
			munRelay_Off_Time--;
		}
		else
		{
			munRelay_Off_Time = 0;
			munRelay_select_Cntr = RELAY_DELAYTIME;		// 0.5 sec = 7500
			meMotorControlStep = MOTORSTEP_RELAY_DELAY;
		}
	}
	else if(meMotorControlStep == MOTORSTEP_RELAY_DELAY)
	{
		if(munRelay_select_Cntr > 0)
		{
			munRelay_select_Cntr--;
		}
		else
		{
			meMotorControlStep = MOTORSTEP_OFFSET_MEASURE;
		}
	}
	else if(meMotorControlStep == MOTORSTEP_OFFSET_MEASURE)
	{
		VC_Get_Iabcs_Offset();	// Current & Vdc Offset Measurement
	}
	else if(meMotorControlStep == MOTORSTEP_BOOTSTRAP)
	{
		if(munBootstrap_Cntr != 0)		//1sec/100ms/66.7us
		{
			munBootstrap_Cntr--;
		}
		else
		{
			if(meControlMotor == DRAIN_MOTOR)		// Motor Select
			{
				meMotorControlStep = MOTORSTEP_ALIGN_START;
			}
			else
			{
				meMotorControlStep = MOTORSTEP_RUNNING;
			}
		}
		munRelay_Off_Time = RELAY_OFFTIME;		// 2.0 sec = 30000
	}
	else if(meMotorControlStep == MOTORSTEP_ALIGN_START)
	{
		if(mulAlignCount < Q14)							// 16384 * 0.0000666666667 = 1.0922666672128 sec
		{
			mulAlignCount++;
		}
		else
		{
			meMotorControlStep = MOTORSTEP_ALIGN_MEASURE;
		}
		munRelay_Off_Time = RELAY_OFFTIME;			// 2.0 sec = 30000
	}
	else if(meMotorControlStep == MOTORSTEP_ALIGN_MEASURE)
	{
		if(mulAlignCount < Q14)								// 16384 * 0.0000666666667 = 1.0922666672128 sec
		{
			mulAlignCount++;
		}
		else
		{
			mulAlignCount = 0;
			meMotorControlStep = MOTORSTEP_ALIGN_STOP;
		}
		munRelay_Off_Time = RELAY_OFFTIME;			// 2.0 sec = 30000
	}
	else if(meMotorControlStep == MOTORSTEP_ALIGN_STOP)
	{
		if(mulAlignCount < 3000)					// 3000 * 0.0000666666667 = 0.2 sec
		{
			mulAlignCount++;
		}
		else
		{
			meMotorControlStep = MOTORSTEP_RUNNING;
		}
		munRelay_Off_Time = RELAY_OFFTIME;		// 2.0 sec = 30000
	}
	else if(meMotorControlStep == MOTORSTEP_RUNNING)
	{
		munRelay_Off_Time = RELAY_OFFTIME;		// 2.0 sec = 30000
	}
	else if(meMotorControlStep == MOTORSTEP_STOP)
	{
		if(munRelay_Off_Time > 0)
		{
			munRelay_Off_Time--;
		}
		else
		{
			;		// Do nothing
		}
	}
	else
	{
		;		// Do nothing
	}

//	VC_Get_Vdc();				// Vdc Measurement
	maucCommRecTempBuffer[DCLINK_AD_VALUE_LOW_MAINCOMM_R_IDX]	= (UINT8)(44159 & 0x00FFU);	// 44159 : 220V 기준 DC Link Value
	maucCommRecTempBuffer[DCLINK_AD_VALUE_HIGH_MAINCOMMM_R_IDX]	= (UINT8)((44159 & 0xFF00U) >> 8U);

	if(mbMOTOR_START_F == FALSE)		// 세척모터 Off 시 IF 기동 횟수 초기화
	{
		mucWashMotor_IF_Count = 0;
	}
	else
	{
		;		///< Do Nothing
	}
}


// SILS SSLS TIMER
void SSLSMotor_ISR_Timer_2ms_IncreaseCnt(void)
{
	static UINT8 uc10MS_Count;

	uc10MS_Count++;

	if(mbTime_RpmSlope_RegularControl_F == SET)
	{
		mbTime_RpmSlope_TimerControl_F = CLEAR;
	}
	else
	{
		;
	}

	if(meMotorType == DRAIN_MOTOR)
	{
		if(uc10MS_Count >= 50)
		{
			uc10MS_Count = 0;
			mbTime_RpmSlope_TimerControl_F = SET;			// Sensorless Vectorcontrol
		}
		else
		{
			;	///< Do Nothing
		}
	}
	else
	{
		if(uc10MS_Count >= 5)
		{
			uc10MS_Count = 0;
			mbTime_RpmSlope_TimerControl_F = SET;			// Sensorless Vectorcontrol
		}
		else
		{
			;	///< Do Nothing
		}
	}
}

// SILS SSLS REGULARCONTROL
static void _SSLSMotorControl(void)
{
	BOOL bWashMotorOnF = WashMotor_IsOn();
	BOOL bDrainMotorOnF = DrainMotor_DC_IsOn();
	static BOOL bPrevWashMotorOnF;
	static BOOL bPrevDrainMotorOnF;

	// Motor Control
	if(	((bWashMotorOnF != bPrevWashMotorOnF) && (bWashMotorOnF == FALSE)) ||
		((bDrainMotorOnF != bPrevDrainMotorOnF) && (bDrainMotorOnF == FALSE))	)
	{
		munTargetRpm = 0;
		mbMOTOR_START_F = FALSE;
	}
	else if((bWashMotorOnF == TRUE) && (bDrainMotorOnF == FALSE))
	{
		meMotorType = WASH_MOTOR;
		mbMotorDirection = CW;
		munTargetRpm = WashMotor_GetTarRPM();
		munTargetRpm = (munTargetRpm < SSLSMOTOR_RUN_MINRPM) ? SSLSMOTOR_RUN_MINRPM : munTargetRpm;
		mbMOTOR_START_F = TRUE;
	}
	else if((bWashMotorOnF == FALSE) && (bDrainMotorOnF == TRUE))
	{
		meMotorType = DRAIN_MOTOR;
		mbMotorDirection = DrainMotor_DC_IsDirectionCCW();
		munTargetRpm = DrainMotor_DC_GetTarRPM();
		munTargetRpm = (munTargetRpm < SSLSMOTOR_RUN_MINRPM) ? SSLSMOTOR_RUN_MINRPM : munTargetRpm;
		munTargetRpm = (munTargetRpm > SSLSMOTOR_DRAIN_RUN_MAXRPM) ? SSLSMOTOR_DRAIN_RUN_MAXRPM : munTargetRpm;
		mbMOTOR_START_F = TRUE;
	}
	else
	{
		munTargetRpm = 0;
		mbMOTOR_START_F = FALSE;
	}

	bPrevWashMotorOnF = bWashMotorOnF;
	bPrevDrainMotorOnF = bDrainMotorOnF;
}

static void _IPM_Temperature_Control(void)
{
	static T_Time stTimer_MotorStop_Timer;
	static BOOL bIPM_TempControl;

	if(	(Sensor_IPMTemperature_GetTemp_SSLS() >= IPM_UPPERLIMIT_TEMP) &&
		(bIPM_TempControl == FALSE)	)
	{
		bIPM_TempControl = TRUE;
		Timer_GetTime(&stTimer_MotorStop_Timer);
	}
	else
	{
		;		///< Do nothing
	}

	if(	(Timer_SecCheckPassTime(&stTimer_MotorStop_Timer, IPM_MOTOR_STOP_TIME_SEC, NONE) == TRUE) &&
		(bIPM_TempControl == TRUE)	)
	{
		bIPM_TempControl = FALSE;
		if(mbMOTOR_START_F == TRUE)
		{
			mbMotorRegularStart_F = TRUE;
		}
		else
		{
			;		///< Do nothing
		}
		mb_IsIPMTempControl_SSLS = FALSE;
	}
	else
	{
		;		///< Do nothing
	}

	if(bIPM_TempControl == TRUE)
	{
		munRequestRpm = 0;
		mbMotorRegularStop_F = TRUE;
		mb_IsIPMTempControl_SSLS = TRUE;
	}
	else
	{
		;		///< Do nothing
	}

	maucCommRecTempBuffer[IPM_TEMP_CONTROL_INVCOMM_R_IDX]				= mb_IsIPMTempControl_SSLS;
}

static void _Calculate_SSLSMotor_CurrentRPM(void)
{
	munCurrentRPM = munRequestRpm;

	if(meMotorType == DRAIN_MOTOR)
	{
		maucCommRecTempBuffer[DRAIN_CURRENT_RPM_LOW_INVCOMM_R_IDX]	= (UINT8)(munCurrentRPM & 0x00FFU);
		maucCommRecTempBuffer[DRAIN_CURRENT_RPM_HIGH_INVCOMM_R_IDX]	= (UINT8)((munCurrentRPM & 0xFF00U) >> 8U);
		maucCommRecTempBuffer[DRAIN_REQUEST_RPM_LOW_INVCOMM_R_IDX]	= (UINT8)(munRequestRpm & 0x00FFU);
		maucCommRecTempBuffer[DRAIN_REQUEST_RPM_HIGH_INVCOMM_R_IDX]	= (UINT8)((munRequestRpm & 0xFF00U) >> 8U);
		maucCommRecTempBuffer[WASH_CURRENT_RPM_LOW_INVCOMM_R_IDX]	= 0;
		maucCommRecTempBuffer[WASH_CURRENT_RPM_HIGH_INVCOMM_R_IDX]	= 0;
		maucCommRecTempBuffer[WASH_REQUEST_RPM_LOW_INVCOMM_R_IDX]	= 0;
		maucCommRecTempBuffer[WASH_REQUEST_RPM_HIGH_INVCOMM_R_IDX]	= 0;
	}
	else
	{
		maucCommRecTempBuffer[DRAIN_CURRENT_RPM_LOW_INVCOMM_R_IDX]	= 0;
		maucCommRecTempBuffer[DRAIN_CURRENT_RPM_HIGH_INVCOMM_R_IDX]	= 0;
		maucCommRecTempBuffer[DRAIN_REQUEST_RPM_LOW_INVCOMM_R_IDX]	= 0;
		maucCommRecTempBuffer[DRAIN_REQUEST_RPM_HIGH_INVCOMM_R_IDX]	= 0;
		maucCommRecTempBuffer[WASH_CURRENT_RPM_LOW_INVCOMM_R_IDX]	= (UINT8)(munCurrentRPM & 0x00FFU);
		maucCommRecTempBuffer[WASH_CURRENT_RPM_HIGH_INVCOMM_R_IDX]	= (UINT8)((munCurrentRPM & 0xFF00U) >> 8U);
		maucCommRecTempBuffer[WASH_REQUEST_RPM_LOW_INVCOMM_R_IDX]	= (UINT8)(munRequestRpm & 0x00FFU);
		maucCommRecTempBuffer[WASH_REQUEST_RPM_HIGH_INVCOMM_R_IDX]	= (UINT8)((munRequestRpm & 0xFF00U) >> 8U);
	}
}

static void _RC_Command_Cntl(void)
{
	if(mbMOTOR_START_F == TRUE)
	{
		if(mbMOTOR_START_F_Pre == FALSE)
		{
			mbMotorRegularStart_F = TRUE;
			mbMotorRegularStop_F = FALSE;
		}
		else
		{
			;
		}
	}
	else	//motor operation stop
	{
		munRequestRpm = 0;
		mbMotorRegularStart_F = FALSE;
		mbMotorRegularStop_F = TRUE;
	}

	mbMOTOR_START_F_Pre = mbMOTOR_START_F;
}

static void _RC_RpmSlopeControl(void)
{
	UINT16	unRequestRpmTemp = munRequestRpm;
	static BOOL bFirstFlag;

	if((munRequestRpm != munTargetRpm) &&  (meMotorControlStep == MOTORSTEP_RUNNING))	//motor on
	{
		if((mbTime_RpmSlope_TimerControl_F == SET) && (mbTime_RpmSlope_RegularControl_F == CLEAR))		//100ms 주기 제어
		{
			if(bFirstFlag == CLEAR)
			{
				bFirstFlag = SET;
			}
			else
			{
				if(meMotorType == DRAIN_MOTOR)						// 배수모터: 100ms마다 RPM 증가
				{
					munRpmSlope_Inc = 100;
				}
				else												// 세척모터: 10ms마다 RPM 증가
				{
					 if(munRequestRpm <= 620)
					 {
						 if(mucWashMotor_IF_Count <= SSLSMOROR_WASH_IF_SLOPE_100RPM_COUNT)
						 {
							 munRpmSlope_Inc = 10;
						 }
						 else
						 {
							 munRpmSlope_Inc = 5;
						 }
					 }
					 else
					 {
						 if(mbWashMotorIntermit == FALSE)
						 {
							 munRpmSlope_Inc = 25;
						 }
						 else
						 {
							 munRpmSlope_Inc = 5;
						 }
					 }
				}

				if(munTargetRpm >= munRequestRpm)					// 가속 제어 모드 ========
				{
					unRequestRpmTemp += munRpmSlope_Inc;
					if(unRequestRpmTemp >= munTargetRpm)
					{
						munRequestRpm = munTargetRpm;
					}
					else
					{
						munRequestRpm += munRpmSlope_Inc;
					}
				}
				else												// 감속 제어 모드 ========
				{
					if(unRequestRpmTemp >= munRpmSlope_Inc)
					{
						unRequestRpmTemp -= munRpmSlope_Inc;
					}
					else
					{
						unRequestRpmTemp = 0;
					}

					if(unRequestRpmTemp <= munTargetRpm)
					{
						munRequestRpm = munTargetRpm;
					}
					else
					{
						munRequestRpm -= munRpmSlope_Inc;
					}
				}
			}
		}
		else
		{
			;		///< Do nothing
		}
	}
	else
	{
		bFirstFlag = CLEAR;
	}

	mbTime_RpmSlope_RegularControl_F = mbTime_RpmSlope_TimerControl_F;
}

void SSLSMotor_RegularControl(void)
{
	mbMotorRegularControl_F = TRUE;		// Regular Start 또는 Stop 명령어의 모터 인터럽트  Lock 설정

	if((mbMotorRegularStop_F == TRUE) && (meMotorControlStep == MOTORSTEP_STOP))
	{
		mbMotorRegularStop_F = FALSE;
	}
	else if((mbMotorRegularStart_F == TRUE) && (meMotorControlStep != MOTORSTEP_STOP))
	{
		mbMotorRegularStart_F = FALSE;
	}
	else
	{
		;		///< Do nothing
	}

	// Motor 동작 여부 판단
	_SSLSMotorControl();

	_IPM_Temperature_Control();

	_Calculate_SSLSMotor_CurrentRPM();

	_RC_Command_Cntl();			// Sensorless Vectorcontrol
	_RC_RpmSlopeControl();		// Sensorless Vectorcontrol

	mbMotorRegularControl_F = FALSE;		// Regular Start 또는 Stop 명령어의 모터 인터럽트  Lock 해제
}
#endif
