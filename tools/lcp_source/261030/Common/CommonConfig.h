/*
 * CommonConfig.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

#ifndef COMMONCONFIG_H_
#define COMMONCONFIG_H_

UINT32 CommonConfig_Get_MainSWPartNumber(void);
UINT32 CommonConfig_Get_MainSWCheckSum(void);
UINT16 CommonConfig_Get_MainFOTACheckSum(void);
UINT8 CommonConfig_Get_MainSWVersion(void);
UINT8 CommonConfig_Get_LocalInfo(void);
UINT8 CommonConfig_Get_ModelInfo(void);
UINT8 CommonConfig_Get_UPContentsIdCount(void);
T_Context* CommonConfig_Get_Context(void);

#endif /* COMMONCONFIG_H_ */
