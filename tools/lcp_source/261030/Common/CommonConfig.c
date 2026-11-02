/*
 * CommonConfig.h
 *
 *  Created on: 2025. 10. 30.
 *      Author: Hyuntaek.cho
 */

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"


/* --------------- Define 정의  ---------------  */
#define SW_PART_NUMBER			(30458201)
#define CHECKSUM_VALUE			(0x07890EDA)
#define	MAIN_VERSION			(1)


/* --------------- Typedef형 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */
#pragma section MAIN_CHECKSUM
static const UINT32 maulMainCheckSum[2] = {CHECKSUM_VALUE, ~CHECKSUM_VALUE};
#pragma section

static T_Context mst_Context;

/* --------------- 전역 상수 정의  ---------------  */
const UINT8 gaucArea[] = {0x00, 0x01, 0x03, 0x07, 0x0F, 0x1F, 0x3F, 0x7F, 0xFF};		// BIT 연산을 위한 테이블


/* --------------- 함수 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */
/**
* @fnUINT16 CommonConfig_Get_MainSWPartNumber(void)
* Main SW Part Number 반환
* @param					없음
* @return			SW Part Number
* @see								없음
*/
UINT32 CommonConfig_Get_MainSWPartNumber(void)
{
	return (UINT32)SW_PART_NUMBER;
}

/**
* @fn UINT32 CommonConfig_Get_MainSWCheckSum(void)
* Main CheckSum 반환
* @param	없음
* @return	UINT32		Main CheckSum
* @see		없음
*/
UINT32 CommonConfig_Get_MainSWCheckSum(void)
{
#ifndef __SILS__
	return maulMainCheckSum[0];
#else
	extern unsigned long SILS_BOOT_WRAP_getChecksum();
	return SILS_BOOT_WRAP_getChecksum();
#endif
}

/**
* @fn UINT8 CommonConfig_Get_MainSWVersion(void)
* Main SW Version 반환
* @param	없음
* @return	UINT8		Main SW Version
* @see		없음
*/
UINT8 CommonConfig_Get_MainSWVersion(void)
{
	return MAIN_VERSION;
}

/**
* @fn UINT8 CommonConfig_Get_LocalInfo(void)
* 지역정보 Return 하는 함수
* @param	없음
* @return	LOCAL_INFO		Europe : 0, Korea : 1, Australia : 2, America : 3, India : 4
* @see
*/
UINT8 CommonConfig_Get_LocalInfo(void)
{
	return LOCALINFO_DOMESTIC;
}

/**
* @fn UINT8 CommonConfig_Get_ModelInfo(void)
* 지역정보 Return 하는 함수
* @param	없음
* @return	Model_Info
* @see
*/
UINT8 CommonConfig_Get_ModelInfo(void)
{
	return MODELINFO_KOR_9S;
}

/**
* @fn UINT8 CommonConfig_Get_UPContentsIdCount(void)
* UP Contents 갯수 반환
* @param	없음
* @return	UINT8		UP Contents 갯수
* @see		없음
*/
UINT8 CommonConfig_Get_UPContentsIdCount(void)
{
	return 0;
}

/**
* @fn	T_Context* CommonConfig_Get_Context(void)
* JobContext 구조체 정보 반환
* @param	없음
* @return	T_Context	JobContext 구조체 정보
* @see		없음
*/
T_Context* CommonConfig_Get_Context(void)
{
	return &mst_Context;
}