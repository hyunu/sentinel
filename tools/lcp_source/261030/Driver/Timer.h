/*
 * Timer.h
 *
 *  Created on: 2013. 8. 28.
 *      Author: youngho1.hwang
 */

#ifndef TIMER_H_
#define TIMER_H_

#define UPDATE		1
#define NONE		0

typedef struct
{
	UINT8 ucHigh;
	UINT32 ulLow;
} T_Time;


BOOL Timer_MsecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption);
BOOL Timer_HourCheckPassTime(T_Time* pstTime, UINT8 ucTime, UINT8 ucUpdateOption);
BOOL Timer_MinCheckPassTime(T_Time* pstTime, UINT16 unTime, UINT8 ucUpdateOption);
BOOL Timer_SecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption);
void Timer_GetTime(T_Time* pstTime);
void Timer_TimeInc(void);

BOOL ProcessTimer_MsecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption);
BOOL ProcessTimer_HourCheckPassTime(T_Time* pstTime, UINT8 ucTime, UINT8 ucUpdateOption);
BOOL ProcessTimer_MinCheckPassTime(T_Time* pstTime, UINT16 unTime, UINT8 ucUpdateOption);
BOOL ProcessTimer_SecCheckPassTime(T_Time* pstTime, UINT32 ulTime, UINT8 ucUpdateOption);
UINT32 ProcessTimer_MsecGetPassedTime(T_Time* pstTime);
void ProcessTimer_GetTime(T_Time* pstTime);
void ProcessTimer_TimeInc(void);

#endif /* TIMER_H_ */
