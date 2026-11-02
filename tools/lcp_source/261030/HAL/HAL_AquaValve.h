/*
 * HAL_AquaValve.h
 *
 *  Created on: 2013. 7. 30.
 *      Author: seongju.lim
 */

#ifndef HAL_AQUAVALVE_H_
#define HAL_AQUAVALVE_H_

void HAL_AquaValve_Init(void);
void HAL_AquaValve_TurnOn(void);
void HAL_AquaValve_TurnOff(void);
BOOL HAL_AquaValve_IsOn(void);

#endif /* HAL_AQUAVALVE_H_ */
