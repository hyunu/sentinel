/*
 * PowerRelay.h
 *
 *  Created on: 2013. 7. 8.
 *      Author: youngho1.hwang
 */

#ifndef POWERRELAY_H_
#define POWERRELAY_H_


void PowerRelay_TurnOn(void);
void PowerRelay_TurnOff(void);
BOOL PowerRelay_IsOn(void);
double PowerRelay_GetEnergyUsageWatt(void);

#endif /* POWERRELAY_H_ */
