/*
 * HAL_HeatDryDoor.h
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#ifndef HAL_HEATDRYDOOR_H_
#define HAL_HEATDRYDOOR_H_

void HAL_HeatDryDoor_Init(void);
BOOL HAL_HeatDryDoor_IsOpen(void);
void HAL_HeatDryDoor_Isr_Timer_10ms_SensingSignal(void);

#endif /* HAL_HEATDRYDOOR_H_ */
