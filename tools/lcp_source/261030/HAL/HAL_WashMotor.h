/*
 * HAL_WashMotor.h
 *
 *  Created on: 2013. 7. 29.
 *      Author: seongju.lim
 */

#ifndef HAL_WASHMOTOR_H_
#define HAL_WASHMOTOR_H_

#include "../Driver/WashMotor.h"

UINT16	HAL_WashMotor_GetTarRPM(void);
void	HAL_WashMotor_SetTarRPM(UINT16 unRPM);
UINT16	HAL_WashMotor_GetCurRPM(void);
void	HAL_WashMotor_SetCurRPM(UINT16 unCurRPM);
UINT16	HAL_WashMotor_GetRequestRPM(void);
void	HAL_WashMotor_SetRequestRPM(UINT16 unReqRPM);
UINT16	HAL_WashMotor_GetMotorCurrent(void);
void	HAL_WashMotor_SetMotorCurrent(UINT16 unCurrent);
UINT16	HAL_WashMotor_GetMotorWatt(void);
void	HAL_WashMotor_SetMotorWatt(UINT16 unWatt);
void	HAL_WashMotor_TurnOn(void);
void	HAL_WashMotor_TurnOff(void);
BOOL	HAL_WashMotor_IsOn(void);
void	HAL_WashMotor_SetIntermitWashFlag(void);
void	HAL_WashMotor_SetNormalFlag(void);
void	HAL_WashMotor_Init(void);
BOOL	HAL_WashMotor_IsLEFlagSet(void);
void	HAL_WashMotor_ClearLEFlag(void);
void	HAL_WashMotor_SetLEFlag(void);
UINT16	HAL_WashMotor_GetMotorAverageCurrent(void);
void	HAL_WashMotor_RegularControl(void);

#endif /* HAL_WASHMOTOR_H_ */
