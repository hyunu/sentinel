/*********************************************************************
*
* Device     : RX/RX200
*
* File Name  : resetprg.c
*
* Abstract   : Reset Program.
*
* History    : 1.00  (2010-12-17)
*            : 1.10  (2011-02-21)
*            : 1.11  (2011-06-20)
*            : 1.20  (2018-03-26)
*            : 1.30  (2019-04-12)
*
* NOTE       : THIS IS A TYPICAL EXAMPLE.
*
* Copyright (C) 2010 (2011-2019) Renesas Electronics Corporation.
* All rights reserved.
*
*********************************************************************/

#include <machine.h>
#include <_h_c_lib.h>
//#include <stddef.h>					// Remove the comment when you use errno
//#include <stdlib.h>					// Remove the comment when you use rand()
#include "../Driver/Device/RX130.h"
#include "../SystemManager/SystemManager.h"
// #include "typedefine.h"		// Define Types
// #include "stacksct.h"		// Stack Sizes (Interrupt and User)
#include "../Common/Type.h"

/*******************************************************************************
* Stack Size Settings (stacksct.h)
*******************************************************************************/
#pragma stacksize su = 0x800
#pragma stacksize si = 0x800


/*******************************************************************************
* Macro Definitions
*******************************************************************************/
#define PSW_init  0x00010000	// PSW bit pattern
#define FPSW_init 0x00000000	// FPSW bit base pattern


/*******************************************************************************
* Function Prototypes
*******************************************************************************/
#ifdef __cplusplus
extern "C" {
#endif
void PowerON_Reset_PC(void);
void Set_MainClock(void);
#ifdef __cplusplus
}
#endif

//#ifdef __cplusplus				// Use SIM I/O
//extern "C" {
//#endif
//extern void _INIT_IOLIB(void);
//extern void _CLOSEALL(void);
//#ifdef __cplusplus
//}
//#endif

//extern void srand(_UINT);		// Remove the comment when you use rand()
//extern _SBYTE *_s1ptr;				// Remove the comment when you use strtok()
		
//#ifdef __cplusplus				// Use Hardware Setup
//extern "C" {
//#endif
//extern void HardwareSetup(void);
//#ifdef __cplusplus
//}
//#endif
	
//#ifdef __cplusplus			// Remove the comment when you use global class object
//extern "C" {					// Sections C$INIT and C$END will be generated
//#endif
//extern void _CALL_INIT(void);
//extern void _CALL_END(void);
//#ifdef __cplusplus
//}
//#endif

/**
 * @fn void PowerON_Reset_PC(void)
 * Power On 후, 메모리 및 Micom 설정
 * @param	없음
 * @return	없음
 * @see		없음
 */
#pragma section ResetPRG			// Output PowerON_Reset to PResetPRG section
#pragma entry PowerON_Reset_PC
void PowerON_Reset_PC(void)
{
	clrpsw_i();						// Interrupt disable

	set_intb(__sectop("C$VECT"));

	Set_MainClock();

	_INITSCT();						// Initialize Sections
	
//	_INIT_IOLIB();					// Use SIM I/O

//	errno=0;						// Remove the comment when you use errno
//	srand((_UINT)1);				// Remove the comment when you use rand()
//	_s1ptr=NULL;					// Remove the comment when you use strtok()
		
//	HardwareSetup();				// Use Hardware Setup

//	_CALL_INIT();					// Remove the comment when you use global class object

	set_psw(PSW_init);				// Initialize Ubit & Ibit for PSW
//	chg_pmusr();					// Remove the comment when you need to change PSW PMbit (SuperVisor->User)

	Main();

//	_CLOSEALL();					// Use SIM I/O
	
//	_CALL_END();					// Remove the comment when you use global class object

	brk();
}

/**
 * @fn void Set_MainClock(void)
 * Main clock 설정
 * @param	없음
 * @return	없음
 * @see		없음
 */
void Set_MainClock(void)
{
	/* ---- Enable write protection ---- */
	SYSTEM.PRCR.WORD = 0xA50F;

	/* Set main clock control registers */
    SYSTEM.MOFCR.BYTE = 0x00;		//_00_CGC_MAINOSC_RESONATOR | _00_CGC_MAINOSC_UNDER10M;
    SYSTEM.MOSCWTCR.BYTE = 0x04;	//_04_CGC_OSC_WAIT_CYCLE_8192;

    /* Set main clock operation */
    SYSTEM.MOSCCR.BIT.MOSTP = 0;

    /* Wait for main clock oscillator wait counter overflow */
    while (1 != SYSTEM.OSCOVFSR.BIT.MOOVF);

    /* Set system clock */
    SYSTEM.SCKCR.LONG = 0x00000000;		//_00000000_CGC_PCLKD_DIV_1 | _00000000_CGC_PCLKB_DIV_1 | _00000000_CGC_ICLK_DIV_1 | _00000000_CGC_FCLK_DIV_1;

    while (0x00000000 != SYSTEM.SCKCR.LONG);

    /* Set PLL circuit */
    SYSTEM.PLLCR.WORD = 0x0700;	//_0000_CGC_PLL_FREQ_DIV_1 | _0700_CGC_PLL_FREQ_MUL_4_0;
    SYSTEM.PLLCR2.BIT.PLLEN = 0;

    /* Wait for PLL wait counter overflow */
    while (1 != SYSTEM.OSCOVFSR.BIT.PLOVF);

    /* Disable sub-clock */
    SYSTEM.SOSCCR.BIT.SOSTP = 1;

    /* Wait for the register modification to complete */
    while (1 != SYSTEM.SOSCCR.BIT.SOSTP);

    /* Disable sub-clock */
    RTC.RCR3.BIT.RTCEN = 0;

    /* Wait for the register modification to complete */
    while (0 != RTC.RCR3.BIT.RTCEN);

    /* Set IWDT */
    SYSTEM.ILOCOCR.BIT.ILCSTP = 0;

    /* Set operating power control */
    SYSTEM.OPCCR.BIT.OPCM = 0x00;	//_00_LPC_HIGH_SPEED_MODE;
    while (1 == SYSTEM.OPCCR.BIT.OPCMTSF);

    /* Set clock source */
    SYSTEM.SCKCR3.WORD = 0x0400;	//_0400_CGC_CLOCKSOURCE_PLL;

    while (SYSTEM.SCKCR3.WORD != 0x0400);	//_0400_CGC_CLOCKSOURCE_PLL

    /* Set LOCO */
    SYSTEM.LOCOCR.BIT.LCSTP = 0;
}


/************************************************************************
*
* Device     : RX
*
* File Name  : dbsct.c
*
* Abstract   : Setting of B,R Section.
*
* History    : 1.00  (2009-08-07)
*            : 1.10  (2013-02-13)
*
* NOTE       : THIS IS A TYPICAL EXAMPLE.
*
* Copyright (C) 2009 Renesas Electronics Corporation.
* and Renesas Solutions Corporation. All rights reserved.
*
************************************************************************/

#pragma unpack

/* Specify a start of the section C$DSEC */
#pragma section C C$DSEC
extern const struct {
    unsigned char *rom_s;       /* Start address of the initialized data section in ROM */
    unsigned char *rom_e;       /* End address of the initialized data section in ROM   */
    unsigned char *ram_s;       /* Start address of the initialized data section in RAM */
}   _DTBL[] = {
    { __sectop("D"), __secend("D"), __sectop("R") },
    { __sectop("D_2"), __secend("D_2"), __sectop("R_2") },
    { __sectop("D_1"), __secend("D_1"), __sectop("R_1") }
};

/* Specify a start of the section C$BSEC */
#pragma section C C$BSEC
extern const struct {
    unsigned char *b_s;         /* Start address of non-initialized data section */
    unsigned char *b_e;         /* End address of non-initialized data section */
}   _BTBL[] = {
    { __sectop("B"), __secend("B") },
    { __sectop("B_2"), __secend("B_2") },
    { __sectop("B_1"), __secend("B_1") }
};

#pragma section

/*
** CTBL prevents excessive output of L1100 messages when linking.
** Even if CTBL is deleted, the operation of the program does not change.
*/
unsigned char * const _CTBL[] = {
    __sectop("C_1"), __sectop("C_2"), __sectop("C"),
    __sectop("W_1"), __sectop("W_2"), __sectop("W"),
    __sectop("L"), __sectop("SU"),
    __sectop("C$DSEC"), __sectop("C$BSEC"),
    __sectop("C$INIT"), __sectop("C$VTBL"), __sectop("C$VECT"),
	__sectop("PFOTA_BOOT_START"),
};

#pragma packoption


/************************************************************************
*
* Device     : RX/RX600/RX66T
*
* File Name  : intprg.c
*
* Abstract   : Interrupt Program.
*
* History    : 0.5  (2018-01-12)  [Hardware Manual Revision : 0.50]
*
* NOTE       : THIS IS A TYPICAL EXAMPLE.
*
* Copyright (C) 2018 Renesas Electronics Corporation.
*
************************************************************************/

#pragma section IntPRG

// Exception(Supervisor Instruction)
void Excep_SuperVisorInst(void){/* brk(){  } */}

// Exception(Undefined Instruction)
void Excep_UndefinedInst(void){/* brk(){  } */}

// NMI
void NonMaskableInterrupt(void){/* brk(){  } */}

// Dummy
void Dummy(void){/* brk(){  } */}

// BRK
void Excep_BRK(void){ wait(); }

// // BSC BUSERR
// void Excep_BSC_BUSERR(void){/* brk(); */}

// // FCU FRDYI
// void Excep_FCU_FRDYI(void){/* brk(); */}

// // ICU SWINT
// void Excep_ICU_SWINT(void){/* brk(); */}


/************************************************************************
*
* Device     : RX/RX100/RX130
*
* File Name  : vecttbl.c
*
* Abstract   : Initialize of Vector Table and MDE register.
*
* History    : 1.00 (2015-06-30) [Hardware Manual Revision : 0.50]
*
* NOTE       : THIS IS A TYPICAL EXAMPLE.
*
* Copyright (C) 2015 Renesas Electronics Corporation.
*
************************************************************************/

//#pragma section C FIXEDVECT
//
//void (*const Fixed_Vectors[])(void) = {
////;0xffffffd0  Exception(Supervisor Instruction)
//	Excep_SuperVisorInst,
////;0xffffffd4  Reserved
//	Dummy,
////;0xffffffd8  Reserved
//	Dummy,
////;0xffffffdc  Exception(Undefined Instruction)
//	Excep_UndefinedInst,
////;0xffffffe0  Reserved
//	Dummy,
////;0xffffffe4  Reserved
//	Dummy,
////;0xffffffe8  Reserved
//	Dummy,
////;0xffffffec  Reserved
//	Dummy,
////;0xfffffff0  Reserved
//	Dummy,
////;0xfffffff4  Reserved
//	Dummy,
////;0xfffffff8  NMI
//	NonMaskableInterrupt,
////;0xfffffffc  RESET
//	(void (*)(void))0xFFFFC000,		// FOTA_PowerON_Reset_PC
////;<<VECTOR DATA END (POWER ON RESET)>>
//};

#pragma address id_code = 0xFFFFFFA0			// ID codes (Default)
const unsigned long id_code[4] = {				// 45AAAAAA0808070605040302AAAAAAAA
	0x45AAAAAA,
	0x08080706,
	0x05040302,
	0xAAAAAAAA,
};

#pragma address __MDEreg = 0xFFFFFF80			// MDE register (Single Chip Mode)
#ifdef __BIG
	const unsigned long __MDEreg = 0xFFFFFFF8;	// big
#else
	const unsigned long __MDEreg = 0xFFFFFFFF;	// little
#endif

#pragma address __OFS1reg = 0xFFFFFF88			// OFS1 register
const unsigned long __OFS1reg = 0xFFFFFFF8;		// LVD RESET CIRCUIT(Voltage Detection 0, 3.84V)
