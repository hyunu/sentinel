/*
 * HeatDryDoor.h
 *
 *  Created on: 2021. 4. 20.
 *      Author: Hyuntaek.cho
 */

#ifndef HEATDRYDOOR_H_
#define HEATDRYDOOR_H_

void HeatDryDoor_Init(void);
BOOL HeatDryDoor_IsOpen(void);
void HeatDryDoor_Isr_10ms_SensingSignal(void);

#endif /* HEATDRYDOOR_H_ */

