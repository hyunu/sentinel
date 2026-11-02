/*
 * OptionPin_AD.h
 *
 *  Created on: 2021. 9. 10.
 *      Author: hyuntaek.cho
 */

#ifndef OPTIONPIN_AD_H_
#define OPTIONPIN_AD_H_

typedef enum
{
	AD_OPTIONPIN_1,
	AD_OPTIONPIN_2,
	AD_OPTIONPIN_3,

	AD_OPTIONPIN_MAX,
} T_E_ADOption;

UINT8 OptionPin_AD_Chattering(UINT8 ucADOptionPin);

#endif /* OPTIONPIN_AD_H_ */
