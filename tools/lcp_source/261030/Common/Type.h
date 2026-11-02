/*
 * Type.h
 *
 *  Created on: 2013. 9. 5.
 *      Author: hyuntaek.cho
 */

#ifndef TYPE_H_
#define TYPE_H_

// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
// Primary Data Definition
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
typedef unsigned char 	UINT8;
typedef signed char 	INT8;
typedef unsigned short	UINT16;
typedef signed short	INT16;
#ifndef __SILS__
typedef unsigned long 	UINT32;
typedef signed long 	INT32;
typedef unsigned char	BOOL;
#else
typedef unsigned int 	UINT32;
typedef signed int 		INT32;
typedef int				BOOL;
#endif
#define UINT32_MAX_VALUE 	( 4294967295 ) 	/* 0xFFFFFFFF */
#define UINT32_MIN_VALUE 	( 0 ) 			/* 0x00000000 */
#define INT32_MAX_VALUE 	( 2147483647 ) 	/* 0x7FFFFFFF */
#define INT32_MIN_VALUE 	( -2147483648 ) /* 0x80000000 */
#define UINT16_MAX_VALUE 	( 65535 ) 		/* 0xFFFF */
#define UINT16_MIN_VALUE 	( 0 ) 			/* 0x0000 */
#define INT16_MAX_VALUE 	( 32767 ) 		/* 0x7FFF */
#define INT16_MIN_VALUE 	( -32768 ) 		/* 0x8000 */
#define UINT8_MAX_VALUE 	( 255 ) 		/* 0xFF */
#define UINT8_MIN_VALUE 	( 0 ) 			/* 0x00 */
#define INT8_MAX_VALUE 		( 127 ) 		/* 0x7F */
#define INT8_MIN_VALUE 		( -128 ) 		/* 0x80 */

#ifndef NULL
#define 	NULL				((void *)0)
#endif

#define		FALSE				0
#define		TRUE				1

#define		CCW					TRUE
#define		CW					FALSE

#define 	HIGH				TRUE
#define 	LOW					FALSE

#define 	ON					TRUE
#define 	OFF					FALSE

#define 	SET					TRUE
#define	 	CLEAR				FALSE

#define 	NO_PF 				FALSE
#define 	PF 					TRUE


/**
 * structure for accessing in bit
 */
#ifndef __SILS__
struct Bit_t
{
	unsigned char  bit7:1;					/* bit7(MSB) */
	unsigned char  bit6:1;					/* bit6      */
	unsigned char  bit5:1;					/* bit5      */
	unsigned char  bit4:1;					/* bit4      */
	unsigned char  bit3:1;					/* bit3      */
	unsigned char  bit2:1;					/* bit2      */
	unsigned char  bit1:1;					/* bit1      */
	unsigned char  bit0:1;					/* bit0(LSB) */
};

typedef struct
{
	UINT8 b7	:1;
	UINT8 b6	:1;
	UINT8 b5	:1;
	UINT8 b4	:1;
	UINT8 b3	:1;
	UINT8 b2	:1;
	UINT8 b1	:1;
	UINT8 b0	:1;
} BYTE_FIELD;

typedef struct
{
	UINT8 b7	:1;
	UINT8 b6	:1;
	UINT8 b5	:1;
	UINT8 b4	:1;
	UINT8 b3	:1;
	UINT8 b2	:1;
	UINT8 b1	:1;
	UINT8 b0	:1;

	UINT8 b15	:1;
	UINT8 b14	:1;
	UINT8 b13	:1;
	UINT8 b12	:1;
	UINT8 b11	:1;
	UINT8 b10	:1;
	UINT8 b9	:1;
	UINT8 b8	:1;
} WORD_FIELD;
#else
struct Bit_t
{
	unsigned char  bit0 : 1;
	unsigned char  bit1 : 1;
	unsigned char  bit2 : 1;
	unsigned char  bit3 : 1;
	unsigned char  bit4 : 1;
	unsigned char  bit5 : 1;
	unsigned char  bit6 : 1;
	unsigned char  bit7 : 1;
};

typedef struct
{
	UINT8 b0 : 1;
	UINT8 b1 : 1;
	UINT8 b2 : 1;
	UINT8 b3 : 1;
	UINT8 b4 : 1;
	UINT8 b5 : 1;
	UINT8 b6 : 1;
	UINT8 b7 : 1;
} BYTE_FIELD;

typedef struct
{
	UINT8 b0 : 1;
	UINT8 b1 : 1;
	UINT8 b2 : 1;
	UINT8 b3 : 1;
	UINT8 b4 : 1;
	UINT8 b5 : 1;
	UINT8 b6 : 1;
	UINT8 b7 : 1;

	UINT8 b8 : 1;
	UINT8 b9 : 1;
	UINT8 b10 : 1;
	UINT8 b11 : 1;
	UINT8 b12 : 1;
	UINT8 b13 : 1;
	UINT8 b14 : 1;
	UINT8 b15 : 1;
} WORD_FIELD;
#endif

struct byte_two
{
	UINT8 lowbyte;
	UINT8 highbyte;
};

union Big_b
{
	struct byte_two byte_c;
	UINT16 byte_i;
};

#ifndef __SILS__
union UByteDefine
{
	unsigned char BYTE;					/*  Byte Access */
	struct {							/*  Bit  Access */
		unsigned char B7:1;				/*    Bit 7(MSB)*/
		unsigned char B6:1;				/*    Bit 6     */
		unsigned char B5:1;				/*    Bit 5     */
		unsigned char B4:1;				/*    Bit 4     */
		unsigned char B3:1;				/*    Bit 3     */
		unsigned char B2:1;				/*    Bit 2     */
		unsigned char B1:1;				/*    Bit 1     */
		unsigned char B0:1;				/*    Bit 0(LSB)*/
	}BIT;
};
#else
union UByteDefine
{
	unsigned char BYTE;      
	struct {                 
		unsigned char B0 : 1;
		unsigned char B1 : 1;
		unsigned char B2 : 1;
		unsigned char B3 : 1;
		unsigned char B4 : 1;
		unsigned char B5 : 1;
		unsigned char B6 : 1;
		unsigned char B7 : 1;
	}BIT;
};
#endif

union UWordByte
{
	unsigned short W;
	struct {
		unsigned char U;
		unsigned char L;
	}B;
};


// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
// Macro Fuctinon
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$

/**
 * BIT 연산을 위한 테이블
 */
extern const UINT8 gaucArea[];

/* 한 비트 클리어 */
#define	CLEAR_BIT(data, loc)				((data) &= ~(0x1 << (loc)))
/* 연속된 여러 비트 클리어 */
#define CLEAR_BITS(data, bitsize, loc)		((data) &= ~((gaucArea[bitsize]) << (loc)))
/* 한 비트 설정 */
#define SET_BIT(data, loc)					((data) |= (0x1 << (loc)))
/* 연속된 여러 비트 설정 */
#define SET_BITS(data, bitsize, loc)		((data) |= (((gaucArea[bitsize]) << (loc)))
/* 한 비트 반전 */
#define INVERT_BIT(data, loc)				((data) ^= (0x1 << (loc)))
/* 연속된 여러 비트 반전 */
#define INVERT_BITS(data, bitsize, loc)		((data) ^= (((gaucArea[bitsize]) << (loc)))
/* 비트 검사 */
#define CHECK_BIT(data, loc)				(BOOL)(((data) & ((0x1) << (loc))) >> (loc))
/* 비트 추출 */
#define EXTRACT_BITS(data, bitsize, loc)	(((data) >> (loc)) & ((gaucArea[bitsize])))

/* 2byte 변수에서 상위 바이트 추출  */
#define HIBYTE(data)						(UINT8)(((data) & 0xFF00) >> 8)
/* 2byte 변수에서 하위 바이트 추출 */
#define LOBYTE(data)						(UINT8)((data) & 0x00FF)
/* 둘중 크거나 더 큰수를 리턴 */
#define GREATER_VALUE(data1, data2)			((data1 >= data2) ? (data1) : (data2));
/* 둘중 작은 수를 리턴 */
#define SMALLER_VALUE(data1, data2)			((data1 < data2) ? (data1) : (data2));
/* ABS */
#define ABS(a) 								((a) >= 0 ? (a) : -(a))
/* array count - 특정 배열 인자의 갯수를 계산 한다. */
#define ARRAY_COUNT(arrayname)				((sizeof(arrayname)) / (sizeof(arrayname[0])))
/* Macro for accessing in byte */
#define	BYTE(x)								(*(UINT8*)(&x))

#define INC_UINT8_SAFETY( x )				( ( (UINT8)x < UINT8_MAX_VALUE ) ? x++ : x )
#define INC_UINT16_SAFETY( x )				( ( (UINT16)x < UINT16_MAX_VALUE ) ? x++ : x )
#define INC_UINT32_SAFETY( x )				( ( (UINT32)x < UINT32_MAX_VALUE ) ? x++ : x )


// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
// Timer 관련
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
#define		_10MS_PER_50MSEC	5
#define	 	_10MS_PER_100MSEC	10
#define 	_50MS_PER_MIN		1200
#define 	_500MS_PER_MIN		120
#define 	MS_PER_10MSEC		1
#define 	MS_PER_100MSEC		10
#define 	_10MS_PER_SEC		100
#define 	_10MS_PER_500MSEC	50
#define 	_100MS_PER_SEC		10
#define 	_500US_PER_10MS		20
#define 	_500US_PER_100MS	200
#define 	MSEC_PER_SEC		1000
#define 	SEC_PER_MIN			60
#define 	SEC_PER_HOUR		3600
#define 	_100MSEC_PER_MIN	600
#define 	MIN_PER_HOUR		60
#define 	HOUR_PER_DAY		24
#define		DAY_PER_MONTH		30

#define 	TIME_1SEC	1
#define 	TIME_2SEC	2
#define		TIME_8SEC	8


// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
// Common
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
/**
 * Step enum
 */
typedef enum
{
	STEP_0 = 0,
	STEP_1,
	STEP_2,
	STEP_3,
	STEP_4,
	STEP_5,
	STEP_6,
	STEP_7,
	STEP_8,
	STEP_9,
	STEP_10,
	STEP_11,
	STEP_12,
	STEP_13,
	STEP_14,
	STEP_15,
	STEP_16,
	STEP_17,
	STEP_18,
	STEP_19,

	STEP_MAX
} T_E_Step;


/**
 * 현재 식세기 에러 정보
 */
typedef enum
{
	ERROR_NO = 0,			// 에러 없음
	ERROR_F11 = 111,		// 누수 감지
	ERROR_F12 = 112,		// 급수 누수 감지
	ERROR_F13 = 113,		// 거품 과다 감지  <= 단위행정에서 감지해서 감지 결과를 유지
	ERROR_F14 = 114,		// Sump 히터 고장(단락) 감지
	ERROR_F21 = 121,		// 세척모터 고장 감지
	ERROR_F22 = 122,		// Sump 히터 고장(단선) 감지
	ERROR_F23 = 123,		// Vario 모터 or Vario 스위치 고장 감지
	ERROR_F24 = 124,		// Vario 스위치 고장 감지 <= Driver에서 감지해서 감지 결과를 유지
	ERROR_F25 = 125,		// Sump 온도 센서 고장(단락) 감지
	ERROR_F26 = 126,		// Sump 온도 센서 고장(단선) 감지
	ERROR_F27 = 127,		// 아날로그 탁도 센서 고장(단선) 감지
	ERROR_F28 = 128,		// 아날로그 탁도 센서 고장(단락) 감지
	ERROR_F31 = 131,		// 열풍 Fan 고장 감지  <= Driver에서 감지해서 감지 결과를 유지 중(完)
	ERROR_F33 = 133,		// 열풍 히터 고장(단선) 감지
	ERROR_F35 = 135,		// 열풍 온도 센서 고장(단락) 감지  <= Driver에서 감지해서 감지 결과를 유지
	ERROR_F36 = 136,		// 열풍 온도 센서 고장(단선) 감지  <= Driver에서 감지해서 감지 결과를 유지
	ERROR_F37 = 137,		// AOD 고장 감지
	ERROR_F41 = 141,		// 급수 Valve 고장 or Valve 잠김 감지
	ERROR_F42 = 142,		// Flowmeter 고장 감지
	ERROR_F43 = 143,		// WaterJacket Valve 고장 감지
	ERROR_F51 = 151,		// 배수모터 고장 감지
	ERROR_F52 = 152,		// 배수호수 막힘 감지
	ERROR_F53 = 153,		// 배수 입구 막힘 감지
	ERROR_F61 = 161,		// 스팀 히터 고장(단선) 감지  <= Library에서 감지해서 감지 결과를 유지
	ERROR_F62 = 162,		// 스핌 온도 센서 고장(단락) 감지  <= Library에서 감지해서 감지 결과를 유지
	ERROR_F63 = 163,		// 스핌 온도 센서 고장(단선) 감지  <= Library에서 감지해서 감지 결과를 유지
	ERROR_F64 = 164,		// 스팀 밸브 고장 or 수위 전극 센서 고장 감지
	ERROR_F71 = 171,		// 도어 스위치 고장 감지
	ERROR_F72 = 172,		// 건조 안됨, 열풍 도어 스위치 고장 감지

	ALARM_C01 = 201,		// 자동세제 모듈 미장착 감지

	ERROR_MAX
} T_E_Error;

typedef enum
{
	LOCALINFO_EUROPE = 0,
	LOCALINFO_DOMESTIC,
	LOCALINFO_AUSTRAILIA,
	LOCALINFO_AMERICA,
	LOCALINFO_INDIA,
	LOCALINFO_TAIWAN,
	LOCALINFO_MAX
} T_E_LocalInfo;

typedef enum
{
	MODELINFO_KOR_9S = 0,
	MODELINFO_KOR_8S,
	MODELINFO_EU_9S,
	MODELINFO_EU_8S,
	MODELINFO_EU_6S,
	MODELINFO_MAX
} T_E_ModelInfo;

/**
 * Context 정의
 */
typedef struct
{
	// 에러
	T_E_Error eError;							// 에러
	T_E_Error eHiddenError;						// Hidden Error

	// SW 정보 및 제품 정보
	UINT32 ulMainSWPartNumber;
	UINT32 ulMainSWCheckSum;
	UINT8 ucMainSWVersion;
	UINT32 ulInverterSWPartNumber;
	UINT16 unInverterSWCheckSum;
	UINT16 unInverterSWCRC;
	UINT8 ucInverterSWVersion;

	T_E_LocalInfo eLocalInfo;					// 지역 정보
	T_E_ModelInfo eModelInfo;					// 모델 정보
	BOOL bHeatDryProductF;						// Heat Dry 사용/미사용 제품 여부 정보
	BOOL bAutoOpenDoorProductF;					// AutoOpenDoor 사용/미사용 제품 여부 정보
	BOOL bSteamProductF;						// 스팀 / 비스팀 제품 여부 정보
	BOOL bTubLampProductF;						// Tub Lamp 사용/미사용 제품 여부 정보
	BOOL bAutoDispenserProductF;				// 자동 세제 Module 적용 여부 정보
	BOOL bWaterJacketProductF;					// Water Jacket 적용 여부 정보
} T_Context;


/********************************** Library ************************************************************/
/**
 * Library Status
 */
typedef struct
{
	T_E_Error e_Error;
	BOOL ErrorIsDetected;
	BOOL LibraryIsCompleted;
} T_Library_Status;


/********************************** Vario Library ************************************************************/
/**
 * Vario 노즐 상태를 정의
 */
typedef enum
{
	VARIOSTATUS_UNDEFINE = 0,
	VARIOSTATUS_UPPER,
	VARIOSTATUS_ALL,
	VARIOSTATUS_TOP,
	VARIOSTATUS_LOWERTOP,
	VARIOSTATUS_LOWER,
	VARIOSTATUS_NONE,

	VARIOSTATUS_MAX
} T_E_VarioStatus;


/********************************** Driver ************************************************************/
/**
 * Tub Lamp 밝기조절 Level
 */
typedef enum
{
	TUBLAMP_OFF = 0,
	TUBLAMP_LOW,
	TUBLAMP_HIGH,
	TUBLAMP_MAX
} T_E_TubLampBrightLevel;

/**
 * 자동 세제 모듈 상태
 */
typedef enum
{
	AUTODISPENSER_STATUS_UNKNOW = 0,			///< 자동 세제 모듈 모름
	AUTODISPENSER_STATUS_NONE,					///< 자동 세제 모듈 없음
	AUTODISPENSER_STATUS_EXISTENCE,				///< 자동 세제 모듈 있음
	AUTODISPENSER_STATUS_MAX,
} T_E_AutoDispenserStatus;


#endif /* TYPE_H_ */
