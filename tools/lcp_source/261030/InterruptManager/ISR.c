/*
 * ISR.c
 * (Interrupt Service Routine)
 *  Created on: 2014. 1. 4.
 *      Author: seongju.lim
 */

#include <machine.h>
#include "../Common/Type.h"
#include "../Driver/Device/RX130.h"
#include "../Driver/Timer.h"
#include "../HAL/HAL_AutoDispenser.h"
#include "../HAL/HAL_CommInverter.h"
#include "../HAL/HAL_CommonSensing.h"
#include "../HAL/HAL_DetergentRefill.h"
#include "../HAL/HAL_DoorLatch.h"
#include "../HAL/HAL_HeatDryDoor.h"
#include "../HAL/HAL_HeatDryFan.h"
#include "../HAL/HAL_RegenValve.h"
#include "../HAL/HAL_RinseRefill.h"
#include "../HAL/HAL_SaltRefill.h"
#include "../HAL/HAL_Sensor_DCLink.h"
#include "../HAL/HAL_SteamValve.h"
#include "../HAL/HAL_SteamWater.h"
#include "../HAL/HAL_TurbiditySensor.h"
#include "../HAL/HAL_TubLamp.h"
#include "../HAL/HAL_Uart.h"
#include "../HAL/HAL_VarioMotor.h"
#include "../HAL/HAL_WaterJacketValve.h"


/**
* @fn void INT_10M_TIMER(void)
* 500us 인터럽트 수행
* 	1. 부저음( 10ms 주기)
* 	2. door 감지(1ms 주기)
*
* @param
* @return	없음
* @remarks
*/
#pragma interrupt (INT_10M_TIMER(vect=28)) // CMT0 CMI0
void INT_10M_TIMER(void)
{
	static UINT8 uc1MSCheck;
	static UINT8 uc10MSCheck;
	static UINT8 uc50MSCheckTimer;
	static UINT8 uc1SecCheckTimer;
	static UINT8 uc100MSCheckTimer;
	static UINT8 uc500MSCheckTimer;

	// 500 usec
	HAL_WaterJacketValve_Isr_Timer_500us_DutyControl();
	HAL_RegenValve_Isr_Timer_500us_DutyControl();
	HAL_SteamValve_Isr_Timer_500us_DutyControl();

	uc1MSCheck++;
	if(uc1MSCheck >= 2)									// 1 msec
	{
		uc1MSCheck = 0;
		HAL_TubLamp_Isr_Timer_1ms_DutyControl();

		uc10MSCheck++;
		if(uc10MSCheck >= 10)							// 10 msec
		{
			uc10MSCheck = 0;
			Timer_TimeInc();
//			Lib_TimeCntrl_ISR_10ms_ProcessTimerInc();
			HAL_CommonSensing_ISR_Timer_10ms_DecreaseCount();
			HAL_Uart_ISR_Timer_10ms();
			HAL_Comm_ISR_Timer_10ms_DecTimer();	  //INV 통신
			HAL_HeatDryDoor_Isr_Timer_10ms_SensingSignal();
			HAL_SteamWater_Isr_Timer_10ms_SensingSignal();
			HAL_TurbiditySensor_ISR_Timer_10ms_CheckUart();

			uc50MSCheckTimer++;
			if(uc50MSCheckTimer >= 5)					// 50 msec
			{
				uc50MSCheckTimer = 0;
				HAL_DetergentRefill_Isr_Timer_50ms_SensingSignal();
				HAL_RinseRefill_Isr_Timer_50ms_SensingSignal();
				HAL_SaltRefill_Isr_Timer_50ms_SensingSignal();
				HAL_VarioMotor_Isr_Timer_50ms_CheckTimer();
				HAL_VarioMotor_Isr_Timer_50ms_SensingSignal();

				uc100MSCheckTimer++;
				if(uc100MSCheckTimer >= 2)				// 100 msec
				{
					uc100MSCheckTimer = 0;
					HAL_TurbiditySensor_Isr_Timer_100ms_CheckTimer();
					HAL_Sensor_DCLink_Isr_Timer_100ms_CheckTimer();
					HAL_Comm_Error_Check_Timer_100ms_DecTimer();
					
					uc500MSCheckTimer++;
					if(uc500MSCheckTimer >= 5)			// 500 msec
					{
						uc500MSCheckTimer = 0;

						uc1SecCheckTimer++;
						if(uc1SecCheckTimer >= 2)		// 1 Sec
						{
							uc1SecCheckTimer = 0;
//							Lib_TimeCntrl_ISR_1Sec_InfActionTimeInc();
						}
						else
						{
							;	///< Do Nothing
						}
					}
					else
					{
						;	///< Do Nothing
					}
				}
				else
				{
					;	///< Do Nothing
				}
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
	}
	else
	{
		;	///< Do Nothing
	}
}

/**
* @fn void INT_IRQ3(void)
* 자동세재 세제 투입량 체크
* @param	없음
* @return	없음
* @remarks
*/
#pragma interrupt (INT_IRQ3(vect=67))  // ICU IRQ3
void INT_IRQ3(void)
{
	HAL_AutoDispenser_ISR_External_Pulse();
}

/**
* @fn void INT_IRQ6(void)
* HeatDryFan RPM pulse 체크
* @param	없음
* @return	없음
* @remarks
*/
#pragma interrupt (INT_IRQ6(vect=70))  // ICU IRQ6
void INT_IRQ6(void) 
{
	TMR1.TCCR.BYTE = 0x00; // Clock input prohibited
	HAL_HeatDryFan_ISR_External_FG(TMR01.TCNT);
	TMR01.TCNT = 0x0000;
	TMR1.TCCR.BYTE = 0x0B; // Uses internal clock, Counts at PCLKB/32 (1.0 us = 1/(32MHz/32))
}

/**
* @fn void Timer0_Overflow(void)
* HeatDryFan RPM pulse Overflow 체크
* @param	없음
* @return	없음
* @remarks
*/
#pragma interrupt (Timer0_Overflow(vect=176)) // TMR0 OVI0
void Timer0_Overflow(void)
{
	TMR1.TCCR.BYTE = 0x00;				// Clock input prohibited
	TMR01.TCNT = 0xFFFF;
	HAL_HeatDryFan_ISR_External_FG(TMR01.TCNT);
}

/**
* @fn void INT_Safety_TIMER(void)
* 2ms 인터럽트 수행
* @param	없음
* @return	없음
* @remarks
*/
#pragma interrupt (INT_Safety_TIMER(vect=29))	// CMT1 CMI1
void INT_Safety_TIMER(void)
{
	HAL_DoorLatch_Isr_Timer_2ms_SensingSignal();
}

//#pragma interrupt (Excep_SCI0_ERI0(vect=214)) // SCI0 ERI0
//void Excep_SCI0_ERI0(void)
//{
//	UINT8 err_type;
//
//	/* Clear overrun, framing and parity error flags */
//	err_type = SCI0.RDR;
//	err_type = SCI0.SSR.BYTE;
//	err_type &= 0xC7U;
//	err_type |= 0xC0U;
//	SCI0.SSR.BYTE = err_type;
//}

#pragma interrupt (Excep_SCI0_RXI0(vect=215))// SCI0 RXI0
void Excep_SCI0_RXI0(void)
{
	HAL_TurbiditySensor_ISR_Receive_Data();
}

#pragma interrupt (Excep_SCI0_TXI0(vect=216))// SCI0 TXI0
void Excep_SCI0_TXI0(void)
{
	HAL_TurbiditySensor_ISR_Send_Data();
}

//#pragma interrupt (Excep_SCI1_ERI1(vect=218)) // SCI1 ERI1
//void Excep_SCI1_ERI1(void)
//{
//	UINT8 err_type;
//
//	/* Clear overrun, framing and parity error flags */
//	err_type = SCI1.RDR;
//	err_type = SCI1.SSR.BYTE;
//	err_type &= 0xC7U;
//	err_type |= 0xC0U;
//	SCI1.SSR.BYTE = err_type;
//}

#pragma interrupt (Excep_SCI1_RXI1(vect=219))// SCI1 RXI1
void Excep_SCI1_RXI1(void)
{
	HAL_Uart_ISR_Recving_CommData();
}

#pragma interrupt (Excep_SCI1_TXI1(vect=220))// SCI1 TXI1
void Excep_SCI1_TXI1(void)
{
	HAL_Uart_ISR_Sending_CommData();
}

//#pragma interrupt (Excep_SCI5_ERI5(vect=222))// SCI5 ERI5
//void Excep_SCI5_ERI5(void)
//{
//	UINT8 err_type;
//
//	/* Clear overrun, framing and parity error flags */
//	err_type = SCI5.RDR;
//	err_type = SCI5.SSR.BYTE;
//	err_type &= 0xC7U;
// 	err_type |= 0xC0U;
// 	SCI5.SSR.BYTE = err_type;
//}

#pragma interrupt (Excep_SCI5_RXI5(vect=223))// SCI5 RXI5
void Excep_SCI5_RXI5(void)
{
	HAL_Comm_ISR_INV_GetReceiveData();
}

#pragma interrupt (Excep_SCI5_TXI5(vect=224))// SCI5 TXI5
void Excep_SCI5_TXI5(void)
{
	HAL_Comm_ISR_Sending_INVData();
}
