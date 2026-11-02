/**
**************************************************************************
@file 	Driver.h
@brif
 	- DishWasher Device Driver Header File
 	- 부하 단순 제어 기능을 제공한다.

@author 	S-TASK - 박경용J
@date		10.03.16.
@version	0.1a

@section 	License	라이센스 정보
	- copyright (c) 2010 LG Electronics Inc. - All rights reserved.
***************************************************************************/

#ifndef		_DRIVER_H_
#define 	_DRIVER_H_

#ifndef __SILS__

// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
// 일반 Output Driver
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
#define		VARIOMOTOR_PORT				PORT1.PODR.BIT.B4
#define		AQUAVALVE_PORT				PORT1.PODR.BIT.B5	// -- Sump v/v
#define		AOD_OPEN_PORT				PORT1.PODR.BIT.B6	// -- Auto Door Open
#define		WATERJACKETVALVE_PORT		PORTA.PODR.BIT.B0
#define		AOD_ENABLE					PORTA.PODR.BIT.B6	// -- Auto Door Enable
#define 	TUBLAMP_PORT				PORTB.PODR.BIT.B3
#define		STEAMVALVE_PORT				PORTB.PODR.BIT.B4
#define 	REGENVALVE_PORT				PORTB.PODR.BIT.B5
#define		AOD_CLOSE_PORT				PORTC.PODR.BIT.B4	// -- Auto Door Close
#define		TURBIDITYTR_PORT			PORTC.PODR.BIT.B5
#define		DISPENSER_PORT				PORTC.PODR.BIT.B7
#define		INV_15V_START_PORT			PORTE.PODR.BIT.B3
#define		MAIN_12V_START_PORT			PORTE.PODR.BIT.B4
#define		POWERRELAY_PORT				PORTH.PODR.BIT.B1
#define		AUTODISPENSER_CCW_PORT		PORTJ.PODR.BIT.B1
#define		AUTODISPENSER_CW_PORT		PORTJ.PODR.BIT.B3

// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
//  일반 DC 판단 Switch Driver
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
#define		HEATDRYDOORSW_PORT			PORT1.PIDR.BIT.B7	// Heat Dry Door 감지
#define		DETERGENTREFILLSW_PORT		PORT3.PIDR.BIT.B4	// DetergentRefill 감지
#define 	DOORSW_DC_PORT1				PORT3.PIDR.BIT.B5	// Door 감지1
#define		WATERFLOWMETERSW_PORT		PORT5.PIDR.BIT.B4	// 급수량 검지
#define 	DOORSW_DC_PORT2				PORTB.PIDR.BIT.B6	// Door 감지2
#define 	VARIOPOSITIONSW_PORT		PORTB.PIDR.BIT.B7	// Vario Switch
#define 	SALTREFILLSW_PORT			PORTC.PIDR.BIT.B6	// SaltRefill 감지
#define		RINSEREFILLSW_PORT			PORTH.PIDR.BIT.B0	// ReinseRefill 감지
#define		STEAMWATERLEVEL_PORT		PORT4.PIDR.BIT.B4	// Steam Water 감지


#else
#include "Stub_Port.h"
#endif

void RESET(void);
void InitialMicom_Driver(void);
void WatchDogClear_Driver(void);
void UnusedPin_Disable(T_Context*);

#endif /*DRIVER_H_*/

/* End of File */


