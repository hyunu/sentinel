/*
 * HAL_TurbiditySensor.c
 *
 *  Created on: 2013. 7. 31.
 *      Author: youngho1.hwang
 */

#include "../Common/Type.h"
#include "../Driver/TurbiditySensor.h"

/**
* @fn void HAL_TurbiditySensor_Init(void)
* 탁도센서 초기화 함수
* @param	없음
* @return	없음
* @see		최초 전원 On시에 드라이버 초기화 함수 호출
*/
void HAL_TurbiditySensor_Init (void)
{
	TurbiditySensor_Init();
}

/**
* @fn void HAL_TurbiditySensor_TurnOn(void)
* 탁도센서 TR에 대한 On 요청
* @param	없음
* @return	없음
* @see		PowerRelay 포트 On
*/
void HAL_TurbiditySensor_TurnOn(void)
{
	TurbiditySensor_TurnOn();
}

/**
* @fn void HAL_TurbiditySensor_TurnOff(void)
* 탁도센서 TR에 대한 Off 요청
* @param	없음
* @return	없음
* @see		PowerRelay 포트 On
*/
void HAL_TurbiditySensor_TurnOff(void)
{
	TurbiditySensor_TurnOff();
}

/**
* @fn UINT16 HAL_TurbiditySensor_GetNTUValue(void)
* 탁도 ADC 값 반환 함수
* @param	없음
* @return	UINT16	탁도 ADC 감지 값
* @see		탁도 ADC	감지 값 반환 함수
*/
UINT16 HAL_TurbiditySensor_GetNTUValue(void)
{
	return TurbiditySensor_GetNTUValue();
}

/**
* @fn void HAL_TurbiditySensor_RequestStartTurbidityValue(void)
* 탁도 감지 시작 요청 함수
* @param	없음
* @return	없음
* @see		탁도 감지 시작 요청 함수
*/
void HAL_TurbiditySensor_RequestStartTurbidityValue (void)
{
	TurbiditySensor_RequestStartTurbidityValue();
}

/**
* @fn void HAL_TurbiditySensor_IsCompleteTurbidityValue(void)
* 탁도 감지 완료 여부 확인 함수
* @param	없음
* @return	완료시 True, 미완료시 FALSE
* @see		탁도 감지 완료 여부 확인 함수
*/
BOOL HAL_TurbiditySensor_IsCompleteTurbidityValue (void)
{
	return TurbiditySensor_IsCompleteTurbidityValue();
}

/**
* @fn UINT16 HAL_TurbiditySensor_GetTurbidityValue(void)
* 탁도 감지 값 반환 함수
* @param	없음
* @return	UINT16 탁도 감지 값
* @see		탁도 감지 값 반환 함수
*/
UINT16 HAL_TurbiditySensor_GetTurbidityValue(void)
{
	return TurbiditySensor_GetTurbidityValue();
}

/**
* @fn BOOL HAL_TurbiditySensor_IsFault_Communication(void)
* 탁도센서 통신 Fault 확인.
* @param		 없음
* @return	BOOL	탁도센서 통신 Fault시 TRUE, 아니면 : FALSE.
* @see		없음.
*/
BOOL HAL_TurbiditySensor_IsFault_Communication(void)
{
	return TurbiditySensor_IsFault_Communication();
}

/**
* @fn void HAL_TurbiditySensor_RegularControl(void)
* 탁도센서 동작 함수
* @param	없음
* @return	없음
* @see		탁도센서 동작 함수
*/
void HAL_TurbiditySensor_RegularControl (void)
{
	TurbiditySensor_RegularControl();
}

/**
* @fn void HAL_TurbiditySensor_Isr_Timer_100ms_CheckTimer(void)
* 탁도센서 100ms 타이머 감지 인터럽트
* @param	없음
* @return	없음
* @see		탁도센서용 100ms 타이머 감지 인터럽트
*/
void HAL_TurbiditySensor_Isr_Timer_100ms_CheckTimer(void)
{
	TurbiditySensor_Isr_Timer_100ms_CheckTimer();
}

void HAL_TurbiditySensor_ISR_Send_Data(void)
{
	TurbiditySensor_ISR_Send_Data();
}

void HAL_TurbiditySensor_ISR_Receive_Data(void)
{
	TurbiditySensor_ISR_Receive_Data();
}

void HAL_TurbiditySensor_ISR_Timer_10ms_CheckUart(void)
{
	TurbiditySensor_ISR_Timer_10ms_CheckUart();
}
