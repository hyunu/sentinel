/*
 * Lib_EnergyMonitoring.h
 *
 *  Created on: 2021. 10. 11.
 *      Author: hyuntaek.cho
 */

#ifndef LIB_ENERGYMONITORING_H_
#define LIB_ENERGYMONITORING_H_

void Lib_EnergyMonitoring_Start(void);
void Lib_EnergyMonitoring_Stop(void);
BOOL Lib_EnergyMonitoring_IsOn(void);
double Lib_EnergyMonitoring_GetEnergyUsageWatt(void);
UINT16 Lib_EnergyMonitoring_GetEnergyUsageWattHour(void);
void Lib_EnergyMonitoring_RegularControl(void);

#endif /* LIB_ENERGYMONITORING_H_ */
