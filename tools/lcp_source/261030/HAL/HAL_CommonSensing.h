/*
 * HAL_CommonSensing.h
 *
 *  Created on: 2013. 11. 7.
 *      Author: seongju.lim
 */

#ifndef HAL_COMMONSENSING_H_
#define HAL_COMMONSENSING_H_

void HAL_CommonSensing_Init(void);
void HAL_CommonSensing_ISR_Timer_10ms_DecreaseCount(void);
void HAL_CommonSensing_RegularControl(void);

#endif /* HAL_COMMONSENSING_H_ */
