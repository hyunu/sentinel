/*
 * OptionPin.c
 *
 *  Created on: 2025. 4. 28.
 *      Author: janghoon.kim
 */

#include "../Common/Type.h"
#include "../Common/CommonConfig.h"

/**
* @fn void _OptionPin_SetOption(T_Context* pstContext)
* 옵션 Pin 여부 확인에 따라 설정하는 함수
*/
void OptionPin_SetOption(T_Context* pstContext)
{
	pstContext->eLocalInfo = (T_E_LocalInfo)CommonConfig_Get_LocalInfo();
	pstContext->eModelInfo = (T_E_ModelInfo)CommonConfig_Get_ModelInfo();

	switch(pstContext->eModelInfo)
	{
		case MODELINFO_KOR_9S:
			pstContext->bHeatDryProductF = TRUE;					/* Heat Dry Module 적용 여부 확인 */
			pstContext->bAutoOpenDoorProductF = TRUE;				/* Auto Open Door 적용 여부 확인 */
			pstContext->bSteamProductF = TRUE;						/* 스팀 비스팀 여부 확인 */
			pstContext->bTubLampProductF = TRUE;					/* Tub Lamp 적용 여부 확인 */
			pstContext->bAutoDispenserProductF = TRUE;				/* 자동 세제 Module 적용 여부 확인 */
			pstContext->bWaterJacketProductF = TRUE;				/* Water Jacket 적용 여부 확인 */
		break;

		case MODELINFO_KOR_8S:
			pstContext->bHeatDryProductF = FALSE;					/* Heat Dry Module 적용 여부 확인 */
			pstContext->bAutoOpenDoorProductF = TRUE;				/* Auto Open Door 적용 여부 확인 */
			pstContext->bSteamProductF = TRUE;						/* 스팀 비스팀 여부 확인 */
			pstContext->bTubLampProductF = TRUE;					/* Tub Lamp 적용 여부 확인 */
			pstContext->bAutoDispenserProductF = FALSE;				/* 자동 세제 Module 적용 여부 확인 */
			pstContext->bWaterJacketProductF = TRUE;				/* Water Jacket 적용 여부 확인 */
		break;

		case MODELINFO_EU_9S:
			pstContext->bHeatDryProductF = TRUE;					/* Heat Dry Module 적용 여부 확인 */
			pstContext->bAutoOpenDoorProductF = TRUE;				/* Auto Open Door 적용 여부 확인 */
			pstContext->bSteamProductF = TRUE;						/* 스팀 비스팀 여부 확인 */
			pstContext->bTubLampProductF = TRUE;					/* Tub Lamp 적용 여부 확인 */
			pstContext->bAutoDispenserProductF = TRUE;				/* 자동 세제 Module 적용 여부 확인 */
			pstContext->bWaterJacketProductF = TRUE;				/* Water Jacket 적용 여부 확인 */
		break;

		case MODELINFO_EU_8S:
			pstContext->bHeatDryProductF = FALSE;					/* Heat Dry Module 적용 여부 확인 */
			pstContext->bAutoOpenDoorProductF = TRUE;				/* Auto Open Door 적용 여부 확인 */
			pstContext->bSteamProductF = TRUE;						/* 스팀 비스팀 여부 확인 */
			pstContext->bTubLampProductF = TRUE;					/* Tub Lamp 적용 여부 확인 */
			pstContext->bAutoDispenserProductF = FALSE;				/* 자동 세제 Module 적용 여부 확인 */
			pstContext->bWaterJacketProductF = TRUE;				/* Water Jacket 적용 여부 확인 */
		break;

		case MODELINFO_EU_6S:
			pstContext->bHeatDryProductF = FALSE;					/* Heat Dry Module 적용 여부 확인 */
			pstContext->bAutoOpenDoorProductF = TRUE;				/* Auto Open Door 적용 여부 확인 */
			pstContext->bSteamProductF = TRUE;						/* 스팀 비스팀 여부 확인 */
			pstContext->bTubLampProductF = FALSE;					/* Tub Lamp 적용 여부 확인 */
			pstContext->bAutoDispenserProductF = FALSE;				/* 자동 세제 Module 적용 여부 확인 */
			pstContext->bWaterJacketProductF = FALSE;				/* Water Jacket 적용 여부 확인 */
		break;

		default:
			pstContext->bHeatDryProductF = TRUE;					/* Heat Dry Module 적용 여부 확인 */
			pstContext->bAutoOpenDoorProductF = TRUE;				/* Auto Open Door 적용 여부 확인 */
			pstContext->bSteamProductF = TRUE;						/* 스팀 비스팀 여부 확인 */
			pstContext->bTubLampProductF = TRUE;					/* Tub Lamp 적용 여부 확인 */
			pstContext->bAutoDispenserProductF = TRUE;				/* 자동 세제 Module 적용 여부 확인 */
			pstContext->bWaterJacketProductF = TRUE;				/* Water Jacket 적용 여부 확인 */
		break;
	}

}
