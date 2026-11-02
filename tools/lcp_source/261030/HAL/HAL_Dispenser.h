/*
 * HAL_Dispenser.h
 *
 *  Created on: 2013. 7. 25.
 *      Author: youngho1.hwang
 */

#ifndef HAL_DISPENSER_H_
#define HAL_DISPENSER_H_

void HAL_Dispenser_Init(void);
void HAL_Dispenser_TurnOn(void);
void HAL_Dispenser_TurnOff(void);
BOOL HAL_Dispenser_IsOn(void);

#endif /* HAL_DISPENSER_H_ */
