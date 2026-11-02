/*
 * HAL_DrainMotor.h
 *
 *  Created on: 2013. 7. 31.
 *      Author: seongju.lim
 */

#ifndef HAL_DRAINMOTOR_H_
#define HAL_DRAINMOTOR_H_

#define	DRAINMOTOR_MODE_CHANGE_RPM		(1500)
#define	DRAINMOTOR_DRAIN_RPM			(3200)

UINT16 HAL_DrainMotor_GetCurRPM(void);
void HAL_DrainMotor_SetCurRPM(UINT16 unCurRPM);
UINT16 HAL_DrainMotor_GetTarRPM(void);
void HAL_DrainMotor_SetTarRPM(UINT16);
UINT16 HAL_DrainMotor_GetRequestRPM(void);
void HAL_DrainMotor_SetRequestRPM(UINT16 unReqRPM);
UINT16 HAL_DrainMotor_GetMotorCurrent(void);
void HAL_DrainMotor_SetMotorCurrent(UINT16 unCurrent);
UINT16 HAL_DrainMotor_GetMotorWatt(void);
void HAL_DrainMotor_SetMotorWatt(UINT16 unWatt);
void HAL_DrainMotor_Init(void);
void HAL_DrainMotor_TurnOn(void);
void HAL_DrainMotor_TurnOff(void);
BOOL HAL_DrainMotor_IsOn(void);
void HAL_DrainMotor_DirectionCCW(void);
void HAL_DrainMotor_DirectionCW(void);
BOOL HAL_DrainMotor_IsDirectionCCW(void);
UINT16 HAL_DrainMotor_GetMotorAverageCurrent(void);
void HAL_DrainMotor_RegularControl(void);

#endif /* HAL_DRAINMOTOR_H_ */
