/*
 * CommonSensing.h
 *
 *  Created on: 2013. 11. 6.
 *      Author: seongju.lim
 */

#ifndef COMMONSENSING_H_
#define COMMONSENSING_H_

void CommonSensing_Init(void);
void CommonSensing_ISR_Timer_10ms_DecreaseCount(void);
void CommonSensing_RegularControl(void);

#endif /* COMMONSENSING_H_ */
