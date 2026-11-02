/*
 * HAL_SumpHeater.h
 *
 *  Created on: 2013. 7. 24.
 *      Author: youngho1.hwang
 */

#ifndef HAL_SUMPHEATER_H_
#define HAL_SUMPHEATER_H_

void HAL_SumpHeater_Init(void);
void HAL_SumpHeater_TurnOn(void);
void HAL_SumpHeater_TurnOff(void);
BOOL HAL_SumpHeater_IsOn(void);

#endif /* HAL_SUMPHEATER_H_ */
