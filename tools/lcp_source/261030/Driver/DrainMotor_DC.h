/*
 * DrainMotor_DC.h
 *
 *  Created on: 2013. 7. 18.
 *      Author: seongju.lim
 */

#ifndef DRAINMOTOR_DC_H_
#define DRAINMOTOR_DC_H_

UINT16	DrainMotor_DC_GetCurRPM(void);
void	DrainMotor_DC_SetCurRPM(UINT16 unDrainMotorRPM);
UINT16	DrainMotor_DC_GetTarRPM(void);
void	DrainMotor_DC_SetTarRPM(UINT16);
UINT16	DrainMotor_DC_GetRequestRPM(void);
void	DrainMotor_DC_SetRequestRPM(UINT16 unRPM);
UINT16	DrainMotor_DC_GetMotorCurrent(void);
void	DrainMotor_DC_SetMotorCurrent(UINT16 unCurrent);
UINT16	DrainMotor_DC_GetMotorWatt(void);
void	DrainMotor_DC_SetMotorWatt(UINT16 unWatt);
void	DrainMotor_DC_Init(void);
void	DrainMotor_DC_TurnOn(void);
void	DrainMotor_DC_TurnOff(void);
BOOL	DrainMotor_DC_IsOn(void);
void	DrainMotor_DC_DirectionCCW(void);
void	DrainMotor_DC_DirectionCW(void);
BOOL	DrainMotor_DC_IsDirectionCCW(void);
UINT16	DrainMotor_DC_GetMotorAverageCurrent(void);
void	DrainMotor_DC_RegularControl(void);

#endif /* DRAINMOTOR_DC_H_ */
