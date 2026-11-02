/*
 * HAL_OptionPin_AD.c
 *
 *  Created on: 2021. 9. 10.
 *      Author: hyuntaek.cho
 */

#include "../Common/Type.h"
#include "../Driver/OptionPin_AD.h"

/**
* @fn UINT8 HAL_OptionPin_AD_Chattering(UINT8 ucADOptionPin)
* AD Option Chattering 및 AD Step 봔환 함수, 20회 연속 동일 Step인 경우 완료
* @param	UINT8				Option Pin No.
* @return	UINT8				AD Step (0~9)
* @see
*/
UINT8 HAL_OptionPin_AD_Chattering(UINT8 ucADOptionPin)
{
	return OptionPin_AD_Chattering(ucADOptionPin);
}
