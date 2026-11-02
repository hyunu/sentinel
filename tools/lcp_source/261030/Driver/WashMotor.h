/*
 * WashMotor.h
 *
 *  Created on: 2013. 7. 15.
 *      Author: seongju.lim
 */

#ifndef WASHMOTOR_H_
#define WASHMOTOR_H_

#define WASHMOTOR_RPM_MIN					(900)		// 세척모터 최소 RPM
#define WASHMOTOR_RPM_MAX					(4500)		// 세척모터 최대 RPM
#define	WASHMOTOR_SSLS_MODE_CHANGE_RPM		(590)		// 세척모터 SSLS 전환 RPM

UINT16	WashMotor_GetTarRPM(void);
void	WashMotor_SetTarRPM(UINT16 unRPM);
UINT16	WashMotor_GetCurRPM(void);
void	WashMotor_SetCurRPM(UINT16 unWashMotorRPM);
UINT16	WashMotor_GetRequestRPM(void);
void	WashMotor_SetRequestRPM(UINT16 unRPM);
UINT16	WashMotor_GetMotorCurrent(void);
void 	WashMotor_SetMotorCurrent(UINT16 unCurrent);
UINT16	WashMotor_GetMotorWatt(void);
void	WashMotor_SetMotorWatt(UINT16 unWatt);
void	WashMotor_TurnOn(void);
void	WashMotor_TurnOff(void);
BOOL	WashMotor_IsOn(void);
void	WashMotor_SetIntermitWashFlag(void);
void	WashMotor_SetNormalWashFlag(void);
BOOL	WashMotor_IsIntermitFlagSet(void);
void	WashMotor_Init(void);
void	WashMotor_SetLEFlag(void);
BOOL	WashMotor_IsLEFlagSet(void);
void	WashMotor_ClearLEFlag(void);
double	WashMotor_GetEnergyUsageWatt(void);
UINT16	WashMotor_GetMotorAverageCurrent(void);
void	WashMotor_RegularControl(void);

#endif /* WASHMOTOR_H_ */
