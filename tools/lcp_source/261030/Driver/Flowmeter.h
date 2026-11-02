/*
 * Flowmeter.h
 *
 *  Created on: 2013. 7. 10.
 *      Author: youngho1.hwang
 */

#ifndef FLOWMETER_H_
#define FLOWMETER_H_

void FlowMeter_Init(void);
UINT16 FlowMeter_GetWaterSupplyPulse(void);
void FlowMeter_ClearWaterSupplyPulse(void);
UINT16 FlowMeter_GetTotalWaterSupplyPulse(void);
void FlowMeter_ClearTotalWaterSupplyPulse(void);
void FlowMeter_RegularControl(void);

#endif /* FLOWMETER_H_ */
