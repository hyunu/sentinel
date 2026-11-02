/* --------------- Header 정의  ---------------  */
#include <string.h>
#include "../Common/Type.h"
#include "../Common/CommonConfig.h"
#include "../Driver/Driver.h"
#include "../Driver/Timer.h"
#include "../HAL/HAL_AquaValve.h"
#include "../HAL/HAL_AutoOpenDoor.h"
#include "../HAL/HAL_AutoDispenser.h"
#include "../HAL/HAL_CommInverter.h"
#include "../HAL/HAL_DetergentRefill.h"
#include "../HAL/HAL_Dispenser.h"
#include "../HAL/HAL_DoorLatch.h"
#include "../HAL/HAL_DrainMotor.h"
#include "../HAL/HAL_FlowMeter.h"
#include "../HAL/HAL_HeatDryDoor.h"
#include "../HAL/HAL_HeatDryFan.h"
#include "../HAL/HAL_HeatDryHeater.h"
#include "../HAL/HAL_PowerRelay.h"
#include "../HAL/HAL_RegenValve.h"
#include "../HAL/HAL_RinseRefill.h"
#include "../HAL/HAL_SaltRefill.h"
#include "../HAL/HAL_Sensor_DCLink.h"
#include "../HAL/HAL_Sensor_HeatDryTemperature.h"
#include "../HAL/HAL_Sensor_IPMTemperature.h"
#include "../HAL/HAL_Sensor_SteamTemperature.h"
#include "../HAL/HAL_Sensor_SumpTemperature.h"
#include "../HAL/HAL_SteamHeater.h"
#include "../HAL/HAL_SteamValve.h"
#include "../HAL/HAL_SteamWater.h"
#include "../HAL/HAL_SumpHeater.h"
#include "../HAL/HAL_TubLamp.h"
#include "../HAL/HAL_TurbiditySensor.h"
#include "../HAL/HAL_Uart.h"
#include "../HAL/HAL_VarioMotor.h"
#include "../HAL/HAL_WashMotor.h"
#include "../HAL/HAL_WaterJacketValve.h"
#include "../Library/Lib_EnergyMonitoring.h"
#include "RPC_Interface.h"


/* --------------- Define 정의  ---------------  */
#define DRAINMOTOR_RPM_MIN			(800)		// INV에 정의되어있음
#define DRAINMOTOR_RPM_MAX			(3200)		// INV에 정의되어있음
#define HEATDRYFAN_MAX_DUTY			(100)		// HeatDryFan.h에 정의되어있음
#define HEATDRYFAN_MIN_DUTY			(20)		// HeatDryFan.h에 정의되어있음
#define WASHMOTOR_RPM_MIN			(900)		// WashMotor.h에 정의되어있음
#define WASHMOTOR_RPM_MAX			(4500)		// WashMotor.h에 정의되어있음


/* --------------- Typedef형 정의  ---------------  */
typedef UINT8 (*CommandHandler)(const UINT32* paulArg);

typedef struct
{
    CommandHandler handler;
    UINT8 ucRequiredArgCount;
} T_CommandEntry;

typedef enum
{
	VARIOREQ_STOP = 0,
	VARIOREQ_RESUME,
	VARIOREQ_FINDBASEPOINT,
	VARIOREQ_CLEARCOUNT,
	VARIOREQ_SETFIRSTFINDBASEFLAG,

	VARIOREQ_MAX
} T_E_VarioRequest;

/* --------------- 함수 원형 정의  ---------------  */
static UINT8 _AquaValve_Control(const UINT32* paulArg);
static UINT8 _AutoDispenser_Control(const UINT32* paulArg);
static UINT8 _AutoDispenser_Dir(const UINT32* paulArg);		
static UINT8 _AutoDispenser_Request(const UINT32* paulArg);	
static UINT8 _AutoDispenser_Setval(const UINT32* paulArg);	
static UINT8 _AutoOpenDoor_Control(const UINT32* paulArg);	
static UINT8 _Dispenser_Control(const UINT32* paulArg);		
static UINT8 _DrainMotor_Control(const UINT32* paulArg);	
static UINT8 _DrainMotor_Dir(const UINT32* paulArg);		
static UINT8 _DrainMotor_Setval(const UINT32* paulArg);		
static UINT8 _FlowMeter_Request(const UINT32* paulArg);		
static UINT8 _HeatDryFan_Control(const UINT32* paulArg);	
static UINT8 _HeatDryFan_Setval(const UINT32* paulArg);		
static UINT8 _HeatDryFan_Request(const UINT32* paulArg);	
static UINT8 _HeatDryHeater_Control(const UINT32* paulArg);	
static UINT8 _RegenValve_Control(const UINT32* paulArg);	
static UINT8 _DCLink_Request(const UINT32* paulArg);		
static UINT8 _SteamHeater_Control(const UINT32* paulArg);	
static UINT8 _SteamValve_Control(const UINT32* paulArg);	
static UINT8 _SumpHeater_Control(const UINT32* paulArg);	
static UINT8 _TubLamp_Control(const UINT32* paulArg);		
static UINT8 _Tublamp_Setval(const UINT32* paulArg);		
static UINT8 _TurbiditySensor_Control(const UINT32* paulArg);
static UINT8 _TurbiditySensor_Request(const UINT32* paulArg);
static UINT8 _VarioMotor_Request(const UINT32* paulArg);	
static UINT8 _VarioMotor_Setval(const UINT32* paulArg);		
static UINT8 _WashMotor_Setval(const UINT32* paulArg);		
static UINT8 _WashMotor_Control(const UINT32* paulArg);		
static UINT8 _WashMotor_Request(const UINT32* paulArg);		
static UINT8 _WaterJacketValve_Control(const UINT32* paulArg);
static UINT8 _EnergyMonitoring_Request(const UINT32* paulArg);

/* --------------- 전역 변수 정의  ---------------  */


/* --------------- 전역 상수 정의  ---------------  */
static const T_CommandEntry mastCommandTable[FUNCTIONID_MAX] = 
{									/*Function*/			/*# of Arg*/
/*[ 0]*//*AQUAVALVE_CONTROL*/		{	_AquaValve_Control,				1,			},
/*[ 1]*//*AUTODISPENSER_CONTROL*/	{	_AutoDispenser_Control,			1,			},
/*[ 2]*//*AUTODISPENSER_DIR*/		{	_AutoDispenser_Dir,				1,			},
/*[ 3]*//*AUTODISPENSER_REQUEST*/	{	_AutoDispenser_Request,			1,			},
/*[ 4]*//*AUTODISPENSER_SETVAL*/	{	_AutoDispenser_Setval,			1,			},
/*[ 5]*//*AUTOOPENDOOR_CONTROL*/	{	_AutoOpenDoor_Control,			1,			},
/*[ 6]*//*DISPENSER_CONTROL*/		{	_Dispenser_Control,				1,			},
/*[ 7]*//*DRAINMOTOR_CONTROL*/		{	_DrainMotor_Control,			1,			},
/*[ 8]*//*DRAINMOTOR_DIR*/			{	_DrainMotor_Dir,				1,			},
/*[ 9]*//*DRAINMOTOR_SETVAL*/		{	_DrainMotor_Setval,				1,			},
/*[10]*//*FLOWMETER_REQUEST*/		{	_FlowMeter_Request,				1,			},
/*[11]*//*HEATDRYFAN_CONTROL*/		{	_HeatDryFan_Control,			1,			},
/*[12]*//*HEATDRYFAN_SETVAL*/		{	_HeatDryFan_Setval,				1,			},
/*[13]*//*HEATDRYFAN_REQUEST*/		{	_HeatDryFan_Request,			1,			},
/*[14]*//*HEATDRYHEATER_CONTROL*/	{	_HeatDryHeater_Control,			1,			},
/*[15]*//*REGENVALVE_CONTROL*/		{	_RegenValve_Control,			1,			},
/*[16]*//*DCLINK_REQUEST*/			{	_DCLink_Request,				0,			},
/*[17]*//*STEAMHEATER_CONTROL*/		{	_SteamHeater_Control,			1,			},
/*[18]*//*STEAMVALVE_CONTROL*/		{	_SteamValve_Control,			1,			},
/*[19]*//*SUMPHEATER_CONTROL*/		{	_SumpHeater_Control,			1,			},
/*[20]*//*TUBLAMP_CONTROL*/			{	_TubLamp_Control,				1,			},
/*[21]*//*TUBLAMP_SETVAL*/			{	_Tublamp_Setval,				1,			},
/*[22]*//*TURBIDITYSENSOR_CONTROL*/	{	_TurbiditySensor_Control,		1,			},
/*[23]*//*TURBIDITYSENSOR_REQUEST*/	{	_TurbiditySensor_Request,		0,			},
/*[24]*//*VARIOMOTOR_REQUEST*/		{	_VarioMotor_Request,			1,			},
/*[25]*//*VARIOMOTOR_SETVAL*/		{	_VarioMotor_Setval,				2,			},
/*[26]*//*WASHMOTOR_SETVAL*/		{	_WashMotor_Setval,				1,			},
/*[27]*//*WASHMOTOR_CONTROL*/		{	_WashMotor_Control,				1,			},
/*[28]*//*WASHMOTOR_REQUEST*/		{	_WashMotor_Request,				0,			},
/*[29]*//*WATERJACKETVALVE_CONTROL*/{	_WaterJacketValve_Control,		1,			},
/*[30]*//*ENERGYMONITORING_REQUEST*/{	_EnergyMonitoring_Request,		1,			},
};

/* --------------- 함수 정의  ---------------  */
/**
* @fn UINT8 ExecuteFunctionCall(UINT8 ucFuncID, const UINT32* paulArg, UINT8 ucArgCount)
* OSP로부터 수신한 Function ID/Argument를 검증하고 매칭된 핸들러를 수행한다.
* @param	ucFuncID		Function ID
* @param	paulArg		Function Argument 배열 포인터
* @param	ucArgCount	수신된 Argument 개수
* @return	실행 결과 코드
*/
UINT8 ExecuteFunctionCall(UINT8 ucFuncID, const UINT32* paulArg, UINT8 ucArgCount)
{
	UINT8 ucRet = 0;
	const T_CommandEntry* pastCommand = NULL;

	if(ucFuncID >= FUNCTIONID_MAX)	return ERROR_INVALID_FUNC_ID;
	pastCommand = &mastCommandTable[ucFuncID];

	if(pastCommand->handler == NULL)	return ERROR_NOT_DEFINED_FUNC;
	if((paulArg == NULL) || (ucArgCount != pastCommand->ucRequiredArgCount))	return ERROR_NOT_MATCHED_ARG;
	else
	{
		ucRet =  pastCommand->handler(paulArg);
	}

	return ucRet;
}

/**
* @fn void SendMonitoringPacketEncoder(UINT8* paucSendBuffer, const T_Context* pstContext)
* OSP로 송신할 데이터를 취합/ 설정 한다.
* @param	paucSendBuffer	디스플레이 송신용 Buffer
* @param	pstContext		JobContext 정보
* @return	없음
*/
void SendMonitoringPacketEncoder(UINT8* paucSendBuffer, const T_Context* pstContext)
{
	static UINT16 unPacketSeqNo = 0;
	static UINT16 unPacketLength = UARTTX_MAX;

	paucSendBuffer[UARTTX_STX]											=	UART_PACKET_STX;
	paucSendBuffer[UARTTX_PACKET_LENGTH_H]								=	(UINT8)(unPacketLength >> 8);
	paucSendBuffer[UARTTX_PACKET_LENGTH_L]								=	(UINT8)unPacketLength;
	paucSendBuffer[UARTTX_PACKET_FID]									=	UART_PACKET_FID_MONITORING;
	paucSendBuffer[UARTTX_PACKET_SEQ_NO_H]								=	(UINT8)(unPacketSeqNo >> 8);
	paucSendBuffer[UARTTX_PACKET_SEQ_NO_L]								=	(UINT8)unPacketSeqNo++;
	paucSendBuffer[UARTTX_PACKET_ATTRIBUTE]								=	0x00;

	paucSendBuffer[UARTTX_AQUAVALVE_ISON]								=	HAL_AquaValve_IsOn();	
	paucSendBuffer[UARTTX_AUTODISPENSER_ISON]							=	HAL_AutoDispenser_IsOn();
	paucSendBuffer[UARTTX_AUTODISPENSER_ISDIRECTIONCCW]					=	HAL_AutoDispenser_IsDirectionCCW();
	paucSendBuffer[UARTTX_AUTODISPENSER_GETDETERGENTPULSE]				=	HAL_AutoDispenser_GetDetergentPulse();
	paucSendBuffer[UARTTX_AUTODISPENSER_ISCOMPLETECHECKINGSTATUS]		=	HAL_AutoDispenser_IsCompleteCheckingStatus();
	paucSendBuffer[UARTTX_AUTODISPENSER_GETAUTODISPENSERSTATUS]			=	HAL_AutoDispenser_GetAutoDispenserStatus();
	paucSendBuffer[UARTTX_AUTOOPENDOOR_ISMOTORSTATUS]					=	HAL_AutoOpenDoor_IsMotorStatus();
	paucSendBuffer[UARTTX_DETERGENTREFILL_ISEMPTY]						=	HAL_DetergentRefill_IsEmpty();
	paucSendBuffer[UARTTX_DISPENSER_ISON]								=	HAL_Dispenser_IsOn();
	paucSendBuffer[UARTTX_DOORLATCH_ISOPEN]								=	HAL_DoorLatch_IsOpen();
	paucSendBuffer[UARTTX_DOORLATCH1_ISOPEN_DOORLATCH]					=	HAL_DoorLatch_IsOpen_DoorLatch_1();
	paucSendBuffer[UARTTX_DOORLATCH2_ISOPEN_DOORLATCH]					=	HAL_DoorLatch_IsOpen_DoorLatch_2();
	paucSendBuffer[UARTTX_DRAINMOTOR_GETCURRPM_L]						=	(UINT8)HAL_DrainMotor_GetCurRPM();
	paucSendBuffer[UARTTX_DRAINMOTOR_GETCURRPM_H]						=	(UINT8)(HAL_DrainMotor_GetCurRPM() >> 8);
	paucSendBuffer[UARTTX_DRAINMOTOR_GETTARRPM_L]						=	(UINT8)HAL_DrainMotor_GetTarRPM();
	paucSendBuffer[UARTTX_DRAINMOTOR_GETTARRPM_H]						=	(UINT8)(HAL_DrainMotor_GetTarRPM() >> 8);
	paucSendBuffer[UARTTX_DRAINMOTOR_GETREQUESTRPM_L]					=	(UINT8)HAL_DrainMotor_GetRequestRPM();
	paucSendBuffer[UARTTX_DRAINMOTOR_GETREQUESTRPM_H]					=	(UINT8)(HAL_DrainMotor_GetRequestRPM() >> 8);
	paucSendBuffer[UARTTX_DRAINMOTOR_GETMOTORCURRENT_L]					=	(UINT8)HAL_DrainMotor_GetMotorCurrent();
	paucSendBuffer[UARTTX_DRAINMOTOR_GETMOTORCURRENT_H]					=	(UINT8)(HAL_DrainMotor_GetMotorCurrent() >> 8);
	paucSendBuffer[UARTTX_DRAINMOTOR_GETMOTORWATT_L]					=	(UINT8)HAL_DrainMotor_GetMotorWatt();
	paucSendBuffer[UARTTX_DRAINMOTOR_GETMOTORWATT_H]					=	(UINT8)(HAL_DrainMotor_GetMotorWatt() >> 8);
	paucSendBuffer[UARTTX_DRAINMOTOR_ISON]								=	HAL_DrainMotor_IsOn();
	paucSendBuffer[UARTTX_DRAINMOTOR_ISDIRECTIONCCW]					=	HAL_DrainMotor_IsDirectionCCW();
	paucSendBuffer[UARTTX_DRAINMOTOR_GETMOTORAVERAGECURRENT_L]			=	(UINT8)HAL_DrainMotor_GetMotorAverageCurrent();
	paucSendBuffer[UARTTX_DRAINMOTOR_GETMOTORAVERAGECURRENT_H]			=	(UINT8)(HAL_DrainMotor_GetMotorAverageCurrent() >> 8);
	paucSendBuffer[UARTTX_FLOWMETER_GETWATERSUPPLYPULSE_L]				=	(UINT8)HAL_FlowMeter_GetWaterSupplyPulse();
	paucSendBuffer[UARTTX_FLOWMETER_GETWATERSUPPLYPULSE_H]				=	(UINT8)(HAL_FlowMeter_GetWaterSupplyPulse() >> 8);
	paucSendBuffer[UARTTX_FLOWMETER_GETTOTALWATERSUPPLYPULSE_L]			=	(UINT8)HAL_FlowMeter_GetTotalWaterSupplyPulse();
	paucSendBuffer[UARTTX_FLOWMETER_GETTOTALWATERSUPPLYPULSE_H]			=	(UINT8)(HAL_FlowMeter_GetTotalWaterSupplyPulse() >> 8);
	paucSendBuffer[UARTTX_HEATDRYDOOR_ISOPEN]							=	HAL_HeatDryDoor_IsOpen();
	paucSendBuffer[UARTTX_HEATDRYFAN_ISON]								=	HAL_HeatDryFan_IsOn();
	paucSendBuffer[UARTTX_HEATDRYFAN_GETCURRPM_L]						=	(UINT8)HAL_HeatDryFan_GetCurRPM();
	paucSendBuffer[UARTTX_HEATDRYFAN_GETCURRPM_H]						=	(UINT8)(HAL_HeatDryFan_GetCurRPM() >> 8);
	paucSendBuffer[UARTTX_HEATDRYFAN_GETTARDUTY]						=	HAL_HeatDryFan_GetTarDuty();
	paucSendBuffer[UARTTX_HEATDRYFAN_ISLOCKDETECTING]					=	HAL_HeatDryFan_IsLockDetecting();
	paucSendBuffer[UARTTX_HEATDRYFAN_ISRETRYSTATUSAFTERLOCK]			=	HAL_HeatDryFan_IsRetryStatusAfterLock();
	paucSendBuffer[UARTTX_HEATDRYFAN_LOCKRETRYCOUNT]					=	HAL_HeatDryFan_Get_Lock_Retry_Count();
	paucSendBuffer[UARTTX_HEATDRYHEATER_ISON]							=	HAL_HeatDryHeater_IsOn();
	paucSendBuffer[UARTTX_POWERRELAY_ISON]								=	HAL_PowerRelay_IsOn();
	paucSendBuffer[UARTTX_REGENVALVE_ISON]								=	HAL_RegenValve_IsOn();
	paucSendBuffer[UARTTX_RINSEREFILL_ISEMPTY]							=	HAL_RinseRefill_IsEmpty();
	paucSendBuffer[UARTTX_SALTREFILL_ISEMPTY]							=	HAL_SaltRefill_IsEmpty();
	paucSendBuffer[UARTTX_SENSOR_DCLINK_GETDCLINKVOLT_L]				=	(UINT8)HAL_Sensor_DCLink_GetDCLinkVolt();
	paucSendBuffer[UARTTX_SENSOR_DCLINK_GETDCLINKVOLT_H]				=	(UINT8)(HAL_Sensor_DCLink_GetDCLinkVolt() >> 8);
	paucSendBuffer[UARTTX_SENSOR_DCLINK_GETDCLINKVOLT_MAX_L]			=	(UINT8)HAL_Sensor_DCLink_GetMaxDCLinkVolt();
	paucSendBuffer[UARTTX_SENSOR_DCLINK_GETDCLINKVOLT_MAX_H]			=	(UINT8)(HAL_Sensor_DCLink_GetMaxDCLinkVolt() >> 8);
	paucSendBuffer[UARTTX_SENSOR_DCLINK_GETDCLINKVOLT_MIN_L]			=	(UINT8)HAL_Sensor_DCLink_GetMinDCLinkVolt();
	paucSendBuffer[UARTTX_SENSOR_DCLINK_GETDCLINKVOLT_MIN_H]			=	(UINT8)(HAL_Sensor_DCLink_GetMinDCLinkVolt() >> 8);
	paucSendBuffer[UARTTX_SENSOR_DCLINK_ISCOMPLETEACVOLTAGE]			=	HAL_Sensor_DCLink_IsCompleteACVoltage();
	paucSendBuffer[UARTTX_SENSOR_HEATDRYTEMPERATURE_GETVALUE]			=	HAL_Sensor_HeatDryTemperature_GetValue();
	paucSendBuffer[UARTTX_SENSOR_HEATDRYTEMPERATURE_GETTEMPERATURE]		=	HAL_Sensor_HeatDryTemperature_GetTemperature();
	paucSendBuffer[UARTTX_SENSOR_HEATDRYTEMPERATURE_GETTEMPERATURE_MAX]	=	HAL_Sensor_HeatDryTemperature_GetMaxTemperature();
	paucSendBuffer[UARTTX_SENSOR_IPMTEMPERATURE_GETTEMP]				=	HAL_Sensor_IPMTemperature_GetTemp();
	paucSendBuffer[UARTTX_SENSOR_IPMTEMPERATURE_GETTEMP_MAX]			=	HAL_Sensor_IPMTemperature_GetMaxTemp();
	paucSendBuffer[UARTTX_SENSOR_STEAMTEMPERATURE_GETVALUE]				=	HAL_Sensor_SteamTemperature_GetValue();
	paucSendBuffer[UARTTX_SENSOR_STEAMTEMPERATURE_GETTEMPERATURE]		=	HAL_Sensor_SteamTemperature_GetTemperature();
	paucSendBuffer[UARTTX_SENSOR_SUMPTEMPERATURE_GETVALUE]				=	HAL_Sensor_SumpTemperature_GetValue();
	paucSendBuffer[UARTTX_SENSOR_SUMPTEMPERATURE_GETSUMPTEMP]			=	HAL_Sensor_SumpTemperature_GetSumpTemp();
	paucSendBuffer[UARTTX_SENSOR_SUMPTEMPERATURE_GETSUMPTEMP_MAX]		=	HAL_Sensor_SumpTemperature_GetMaxSumpTemp();
	paucSendBuffer[UARTTX_STEAMHEATER_ISON]								=	HAL_SteamHeater_IsOn();
	paucSendBuffer[UARTTX_STEAMVALVE_ISON]								=	HAL_SteamValve_IsOn();
	paucSendBuffer[UARTTX_STEAMWATER_ISSTEAMWATER]						=	HAL_SteamWater_IsSteamWater();
	paucSendBuffer[UARTTX_SUMPHEATER_ISON]								=	HAL_SumpHeater_IsOn();
	paucSendBuffer[UARTTX_TUBLAMP_ISON]									=	HAL_TubLamp_IsOn();
	paucSendBuffer[UARTTX_TURBIDITYSENSOR_GETNTUVALUE_L]				=	(UINT8)HAL_TurbiditySensor_GetNTUValue();
	paucSendBuffer[UARTTX_TURBIDITYSENSOR_GETNTUVALUE_H]				=	(UINT8)(HAL_TurbiditySensor_GetNTUValue() >> 8);
	paucSendBuffer[UARTTX_TURBIDITYSENSOR_ISCOMPLETETURBIDITYVALUE]		=	HAL_TurbiditySensor_IsCompleteTurbidityValue();
	paucSendBuffer[UARTTX_TURBIDITYSENSOR_GETTURBIDITYVALUE_L]			=	(UINT8)HAL_TurbiditySensor_GetTurbidityValue();
	paucSendBuffer[UARTTX_TURBIDITYSENSOR_GETTURBIDITYVALUE_H]			=	(UINT8)(HAL_TurbiditySensor_GetTurbidityValue() >> 8);
	paucSendBuffer[UARTTX_TURBIDITYSENSOR_ISFAULT_COMMUNICATION]		=	HAL_TurbiditySensor_IsFault_Communication();
	paucSendBuffer[UARTTX_VARIOMOTOR_GETSTATE]							=	HAL_VarioMotor_GetState();
	paucSendBuffer[UARTTX_VARIOMOTOR_GETCURREQUEST]						=	HAL_VarioMotor_GetCurRequest();
	paucSendBuffer[UARTTX_VARIOMOTOR_GETCURVARIOPOSITION]				=	HAL_VarioMotor_GetCurVarioPosition();
	paucSendBuffer[UARTTX_VARIOMOTOR_GETTARVARIOPOSITION]				=	HAL_VarioMotor_GetTarVarioPosition();
	paucSendBuffer[UARTTX_VARIOMOTOR_ISCOMPLETE_FINDBASEPOINT]			=	HAL_VarioMotor_IsComplete_FindBasePoint();
	paucSendBuffer[UARTTX_VARIOMOTOR_ISCOMPLETE_MOVETARGETPOS]			=	HAL_VarioMotor_IsComplete_MoveTargetPos();
	paucSendBuffer[UARTTX_VARIOMOTOR_ISFAULT_MOVETARGETPOS]				=	HAL_VarioMotor_IsFault_MoveTargetPos();
	paucSendBuffer[UARTTX_VARIOMOTOR_ISON]								=	HAL_VarioMotor_IsOn();
	paucSendBuffer[UARTTX_VARIOMOTOR_GETSWITCHSTATE]					=	HAL_VarioMotor_GetSwitchState();
	paucSendBuffer[UARTTX_VARIOMOTOR_GETVARIOSWCHECKCOUNT]				=	HAL_VarioMotor_GetVarioSWCheckCount();
	paucSendBuffer[UARTTX_VARIOMOTOR_GETFIRSTVARIOINITTIME]				=	HAL_VarioMotor_GetFirstVarioInitTime();
	paucSendBuffer[UARTTX_WASHMOTOR_GETTARRPM_L]						=	(UINT8)HAL_WashMotor_GetTarRPM();
	paucSendBuffer[UARTTX_WASHMOTOR_GETTARRPM_H]						=	(UINT8)(HAL_WashMotor_GetTarRPM() >> 8);
	paucSendBuffer[UARTTX_WASHMOTOR_GETCURRPM_L]						=	(UINT8)HAL_WashMotor_GetCurRPM();
	paucSendBuffer[UARTTX_WASHMOTOR_GETCURRPM_H]						=	(UINT8)(HAL_WashMotor_GetCurRPM() >> 8);
	paucSendBuffer[UARTTX_WASHMOTOR_GETREQUESTRPM_L]					=	(UINT8)HAL_WashMotor_GetRequestRPM();
	paucSendBuffer[UARTTX_WASHMOTOR_GETREQUESTRPM_H]					=	(UINT8)(HAL_WashMotor_GetRequestRPM() >> 8);
	paucSendBuffer[UARTTX_WASHMOTOR_GETMOTORCURRENT_L]					=	(UINT8)HAL_WashMotor_GetMotorCurrent();
	paucSendBuffer[UARTTX_WASHMOTOR_GETMOTORCURRENT_H]					=	(UINT8)(HAL_WashMotor_GetMotorCurrent() >> 8);
	paucSendBuffer[UARTTX_WASHMOTOR_GETMOTORWATT_L]						=	(UINT8)HAL_WashMotor_GetMotorWatt();
	paucSendBuffer[UARTTX_WASHMOTOR_GETMOTORWATT_H]						=	(UINT8)(HAL_WashMotor_GetMotorWatt() >> 8);
	paucSendBuffer[UARTTX_WASHMOTOR_ISON]								=	HAL_WashMotor_IsOn();
	paucSendBuffer[UARTTX_WASHMOTOR_ISLEFLAGSET]						=	HAL_WashMotor_IsLEFlagSet();
	paucSendBuffer[UARTTX_WASHMOTOR_GETMOTORAVERAGECURRENT_L]			=	(UINT8)HAL_WashMotor_GetMotorAverageCurrent();
	paucSendBuffer[UARTTX_WASHMOTOR_GETMOTORAVERAGECURRENT_H]			=	(UINT8)(HAL_WashMotor_GetMotorAverageCurrent() >> 8);
	paucSendBuffer[UARTTX_WATERJACKETVALVE_ISON]						=	HAL_WaterJacketValve_IsOn();
	paucSendBuffer[UARTTX_LIB_ENERGYMONITORING_ISON]					=	Lib_EnergyMonitoring_IsOn();
	paucSendBuffer[UARTTX_LIB_ENERGYMONITORING_GETENERGYUSAGEWATTHOUR_L]	=	(UINT8)Lib_EnergyMonitoring_GetEnergyUsageWattHour();
	paucSendBuffer[UARTTX_LIB_ENERGYMONITORING_GETENERGYUSAGEWATTHOUR_H]	=	(UINT8)(Lib_EnergyMonitoring_GetEnergyUsageWattHour() >> 8);

	// SW 정보 및 제품 정보
	paucSendBuffer[UARTTX_MAIN_SW_PNO_1]								=	(UINT8)pstContext->ulMainSWPartNumber;
	paucSendBuffer[UARTTX_MAIN_SW_PNO_2]								=	(UINT8)(pstContext->ulMainSWPartNumber >> 8);
	paucSendBuffer[UARTTX_MAIN_SW_PNO_3]								=	(UINT8)(pstContext->ulMainSWPartNumber >> 16);
	paucSendBuffer[UARTTX_MAIN_SW_PNO_4]								=	(UINT8)(pstContext->ulMainSWPartNumber >> 24);
	paucSendBuffer[UARTTX_MAIN_SW_CHECKSUM_L]							=	(UINT8)pstContext->ulMainSWCheckSum;
	paucSendBuffer[UARTTX_MAIN_SW_CHECKSUM_H]							=	(UINT8)(pstContext->ulMainSWCheckSum >> 8);
	paucSendBuffer[UARTTX_MAIN_SW_VERSION]								=	(UINT8)pstContext->ucMainSWVersion;
	paucSendBuffer[UARTTX_INVERTER_SW_PNO_1]							=	(UINT8)pstContext->ulInverterSWPartNumber;
	paucSendBuffer[UARTTX_INVERTER_SW_PNO_2]							=	(UINT8)(pstContext->ulInverterSWPartNumber >> 8);
	paucSendBuffer[UARTTX_INVERTER_SW_PNO_3]							=	(UINT8)(pstContext->ulInverterSWPartNumber >> 16);
	paucSendBuffer[UARTTX_INVERTER_SW_PNO_4]							=	(UINT8)(pstContext->ulInverterSWPartNumber >> 24);
	paucSendBuffer[UARTTX_INVERTER_SW_CHECKSUM_L]						=	(UINT8)pstContext->unInverterSWCheckSum;
	paucSendBuffer[UARTTX_INVERTER_SW_CHECKSUM_H]						=	(UINT8)(pstContext->unInverterSWCheckSum >> 8);
	paucSendBuffer[UARTTX_INVERTER_SW_SAFETY_CRC_L]						=	(UINT8)pstContext->unInverterSWCRC;
	paucSendBuffer[UARTTX_INVERTER_SW_SAFETY_CRC_H]						=	(UINT8)(pstContext->unInverterSWCRC >> 8);
	paucSendBuffer[UARTTX_INVERTER_SW_VERSION]							=	(UINT8)pstContext->ucInverterSWVersion;
	paucSendBuffer[UARTTX_LOCAL_INFO]									=	(UINT8)pstContext->eLocalInfo;
	paucSendBuffer[UARTTX_PRODUCT_INFO]									=	(UINT8)(	(pstContext->bAutoDispenserProductF		<< 4)	|
																						(pstContext->bTubLampProductF			<< 3)	|
																						(pstContext->bSteamProductF				<< 2)	|
																						(pstContext->bAutoOpenDoorProductF		<< 1)	|
																						(pstContext->bHeatDryProductF			<< 0)	);
	paucSendBuffer[UARTTX_SOFTWARE_OPTION_RESERVED]						=	(UINT8)0;

	paucSendBuffer[UARTTX_CRC_H]										=	0x00;		// Uart Driver에서 CRC 처리
	paucSendBuffer[UARTTX_CRC_L]										=	0x00;		// Uart Driver에서 CRC 처리
	paucSendBuffer[UARTTX_ETX]											=	UART_PACKET_ETX;
}

/**
* @fn static UINT8 _AquaValve_Control(const UINT32* paulArg)
* Aqua Valve On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _AquaValve_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_AquaValve_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_AquaValve_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _AutoDispenser_Control(const UINT32* paulArg)
* Auto Dispenser On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _AutoDispenser_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_AutoDispenser_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_AutoDispenser_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _AutoDispenser_Dir(const UINT32* paulArg)
* Auto Dispenser 회전 방향을 설정한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _AutoDispenser_Dir(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_AutoDispenser_SetDirectionCW();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_AutoDispenser_SetDirectionCCW();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _AutoDispenser_Request(const UINT32* paulArg)
* Auto Dispenser 요청성 명령(Clear/Check)을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _AutoDispenser_Request(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_AutoDispenser_ClearDetergentPulse();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_AutoDispenser_StartCheckingStatus();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _AutoDispenser_Setval(const UINT32* paulArg)
* Auto Dispenser 목표 Pulse 값을 설정한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _AutoDispenser_Setval(const UINT32* paulArg)
{
	HAL_AutoDispenser_SetTargetDetergentPulse((UINT8)paulArg[0]);
	return SUCCESS_EXE;
}

/**
* @fn static UINT8 _AutoOpenDoor_Control(const UINT32* paulArg)
* Auto Open Door 제어 명령(Off/Open/Close)을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _AutoOpenDoor_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_AutoOpenDoor_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_AutoOpenDoor_Open();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 2)
	{
		HAL_AutoOpenDoor_Close();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _Dispenser_Control(const UINT32* paulArg)
* Dispenser On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _Dispenser_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_Dispenser_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_Dispenser_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _DrainMotor_Control(const UINT32* paulArg)
* Drain Motor On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _DrainMotor_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_DrainMotor_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_DrainMotor_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _DrainMotor_Dir(const UINT32* paulArg)
* Drain Motor 회전 방향을 설정한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _DrainMotor_Dir(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_DrainMotor_DirectionCW();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_DrainMotor_DirectionCCW();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _DrainMotor_Setval(const UINT32* paulArg)
* Drain Motor 목표 RPM을 유효 범위 확인 후 설정한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _DrainMotor_Setval(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if((paulArg[0] >= DRAINMOTOR_RPM_MIN) && (paulArg[0] <= DRAINMOTOR_RPM_MAX))
	{
		HAL_DrainMotor_SetTarRPM((UINT16)paulArg[0]);
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	
	return ucRet;
}

/**
* @fn static UINT8 _FlowMeter_Request(const UINT32* paulArg)
* FlowMeter 누적 Pulse 초기화 요청을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _FlowMeter_Request(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_FlowMeter_ClearWaterSupplyPulse();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_FlowMeter_ClearTotalWaterSupplyPulse();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _HeatDryFan_Control(const UINT32* paulArg)
* HeatDryFan On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _HeatDryFan_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_HeatDryFan_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_HeatDryFan_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _HeatDryFan_Setval(const UINT32* paulArg)
* HeatDryFan 목표 Duty를 유효 범위 확인 후 설정한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _HeatDryFan_Setval(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if((paulArg[0] >= HEATDRYFAN_MIN_DUTY) && (paulArg[0] <= HEATDRYFAN_MAX_DUTY))
	{
		HAL_HeatDryFan_SetTarDuty((UINT8)paulArg[0]);
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	
	return ucRet;
}

/**
* @fn static UINT8 _HeatDryFan_Request(const UINT32* paulArg)
* HeatDryFan 요청성 명령(락 감지 해제)을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _HeatDryFan_Request(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_HeatDryFan_ClearLockDetecting();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _HeatDryHeater_Control(const UINT32* paulArg)
* HeatDryHeater 제어 명령(Off/On/LQC Off)을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _HeatDryHeater_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_HeatDryHeater_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_HeatDryHeater_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 2)
	{
		HAL_HeatDryHeater_TurnOff_LQC();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 3)
	{
		HAL_HeatDryHeater_TurnOn_TestMode();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _RegenValve_Control(const UINT32* paulArg)
* Regen Valve On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _RegenValve_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_RegenValve_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_RegenValve_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _DCLink_Request(const UINT32* paulArg)
* DCLink AC 전압 측정 요청을 수행한다.
* @param	paulArg	Argument 배열 포인터 (미사용)
* @return	실행 결과 코드
*/
static UINT8 _DCLink_Request(const UINT32* paulArg)
{
	HAL_Sensor_DCLink_RequestACVoltage();
	return SUCCESS_EXE;
}

/**
* @fn static UINT8 _SteamHeater_Control(const UINT32* paulArg)
* Steam Heater On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _SteamHeater_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_SteamHeater_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_SteamHeater_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _SteamValve_Control(const UINT32* paulArg)
* Steam Valve On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _SteamValve_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_SteamValve_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_SteamValve_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _SumpHeater_Control(const UINT32* paulArg)
* Sump Heater On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _SumpHeater_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_SumpHeater_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_SumpHeater_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _TubLamp_Control(const UINT32* paulArg)
* Tub Lamp On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _TubLamp_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_TubLamp_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_TubLamp_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _Tublamp_Setval(const UINT32* paulArg)
* Tub Lamp 밝기 값을 설정한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _Tublamp_Setval(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] <= TUBLAMP_MAX)
	{
		HAL_TubLamp_SetBrightness((T_E_TubLampBrightLevel)paulArg[0]);
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _TurbiditySensor_Control(const UINT32* paulArg)
* Turbidity Sensor On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _TurbiditySensor_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_TurbiditySensor_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_TurbiditySensor_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _TurbiditySensor_Request(const UINT32* paulArg)
* Turbidity 측정 시작 요청을 수행한다.
* @param	paulArg	Argument 배열 포인터 (미사용)
* @return	실행 결과 코드
*/
static UINT8 _TurbiditySensor_Request(const UINT32* paulArg)
{
	HAL_TurbiditySensor_RequestStartTurbidityValue();
	return SUCCESS_EXE;
}

/**
* @fn static UINT8 _VarioMotor_Request(const UINT32* paulArg)
* Vario Motor 요청 명령(Stop/Resume/Base/Clear)을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _VarioMotor_Request(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	switch(paulArg[0])
	{
		case VARIOREQ_STOP:
			HAL_VarioMotor_RequestToStop();
			ucRet = SUCCESS_EXE;
		break;

		case VARIOREQ_RESUME:
			HAL_VarioMotor_RequestToResume();
			ucRet = SUCCESS_EXE;
		break;

		case VARIOREQ_FINDBASEPOINT:
			HAL_VarioMotor_RequestToFindBasePoint();
			ucRet = SUCCESS_EXE;
		break;

		case VARIOREQ_CLEARCOUNT:
			HAL_VarioMotor_ClearVarioSWCheckCount();
			ucRet = SUCCESS_EXE;
		break;

		case VARIOREQ_SETFIRSTFINDBASEFLAG:
			HAL_VarioMotor_SetFirstFindBasePointFlag(SET);
			ucRet = SUCCESS_EXE;
		break;

		default:
			ucRet = ERROR_INVALID_ARG_VALUE;
		break;
	}

	return ucRet;
}

/**
* @fn static UINT8 _VarioMotor_Setval(const UINT32* paulArg)
* Vario Motor 목표 위치 설정/회전 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _VarioMotor_Setval(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if((paulArg[1] > VARIOSTATUS_UNDEFINE) && (paulArg[1] < VARIOSTATUS_MAX))
	{
		if(paulArg[0] == 0)
		{
			HAL_VarioMotor_RequestToRotateVarioPosition((T_E_VarioStatus)paulArg[1]);
			ucRet = SUCCESS_EXE;
		}
		else if(paulArg[0] == 1)
		{
			HAL_VarioMotor_RequestToSetVarioPosition((T_E_VarioStatus)paulArg[1]);
			ucRet = SUCCESS_EXE;
		}
		else
		{
			ucRet = ERROR_INVALID_ARG_VALUE;
		}
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}

	return ucRet;
}

/**
* @fn static UINT8 _WashMotor_Setval(const UINT32* paulArg)
* Wash Motor 목표 RPM을 유효 범위 확인 후 설정한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _WashMotor_Setval(const UINT32* paulArg)
{
	UINT8 ucRet = 0;
	if((paulArg[0] >= WASHMOTOR_RPM_MIN) && (paulArg[0] <= WASHMOTOR_RPM_MAX))
	{
		HAL_WashMotor_SetTarRPM((UINT16)paulArg[0]);
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	
	return ucRet;
}

/**
* @fn static UINT8 _WashMotor_Control(const UINT32* paulArg)
* Wash Motor On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _WashMotor_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_WashMotor_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_WashMotor_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _WashMotor_Request(const UINT32* paulArg)
* Wash Motor 요청 명령(LE Flag Clear)을 수행한다.
* @param	paulArg	Argument 배열 포인터 (미사용)
* @return	실행 결과 코드
*/
static UINT8 _WashMotor_Request(const UINT32* paulArg)
{
	HAL_WashMotor_ClearLEFlag();
	return SUCCESS_EXE;
}

/**
* @fn static UINT8 _WaterJacketValve_Control(const UINT32* paulArg)
* Water Jacket Valve On/Off 명령을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _WaterJacketValve_Control(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		HAL_WaterJacketValve_TurnOff();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		HAL_WaterJacketValve_TurnOn();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}

/**
* @fn static UINT8 _EnergyMonitoring_Request(const UINT32* paulArg)
* Energy Monitoring Start/Stop 요청을 수행한다.
* @param	paulArg	Argument 배열 포인터
* @return	실행 결과 코드
*/
static UINT8 _EnergyMonitoring_Request(const UINT32* paulArg)
{
	UINT8 ucRet = 0;

	if(paulArg[0] == 0)
	{
		Lib_EnergyMonitoring_Stop();
		ucRet = SUCCESS_EXE;
	}
	else if(paulArg[0] == 1)
	{
		Lib_EnergyMonitoring_Start();
		ucRet = SUCCESS_EXE;
	}
	else
	{
		ucRet = ERROR_INVALID_ARG_VALUE;
	}
	return ucRet;
}