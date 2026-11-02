/*
 * HAL_FlowMeter.h
 *
 *  Created on: 2013. 7. 26.
 *      Author: youngho1.hwang
 */

#ifndef HAL_FLOWMETER_H_
#define HAL_FLOWMETER_H_

void HAL_FlowMeter_Init(void);
UINT16 HAL_FlowMeter_GetWaterSupplyPulse(void);
void HAL_FlowMeter_ClearWaterSupplyPulse(void);
UINT16 HAL_FlowMeter_GetTotalWaterSupplyPulse(void);
void HAL_FlowMeter_ClearTotalWaterSupplyPulse(void);
void HAL_FlowMeter_RegularControl(void);

#endif /* HAL_FLOWMETER_H_ */
