/**
**************************************************************************
@file 	Driver.c
@brif
 	- DishWasher Device Driver Source File
 	- 부하 단순 제어 기능을 제공한다.

@author 	S-TASK - 박경용J
@date		10.03.16.
@version	0.1a


@section 	License	라이센스 정보
	- copyright (c) 2010 LG Electronics Inc. - All rights reserved.
	부하 확인
	: 배수펌프, 세제, 린스  디스펜서, Vario Motor, Vario SW, Door SW, Aqua Valve,
	   Steam Heater, Sump Heater
	
***************************************************************************/

/* --------------- Header 정의  ---------------  */
#include "../Common/Type.h"
#include "Device/RX130.h"
#include "Driver.h"

/* --------------- Define 정의  ---------------  */


/* --------------- Typedef형 정의  ---------------  */


/* --------------- 함수 원형 정의  ---------------  */
static void _Port_Init(void);
static void _Uart_Init(void);
static void _Wdt_Init(void);
static void _TMS_Init(void);
static void _ADC_Init(void);
static void _Interrupt_Setting(void);
static void _Safety_Timer_Setting(void);

/* --------------- 상수 정의  ---------------  */


/* --------------- 전역 변수 정의  ---------------  */



// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
// 초기 마이컴 설정 Driver
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
/**
* @fn void InitialMicom(void)
* Micom의 각 기능을 사용하기 전 설정하는 작업을 한다.
* 마이컴 레지스터를 사용 용도에 맞도록 Setting 한다.
*/
void InitialMicom_Driver(void)
{
	MPC.PWPR.BIT.B0WI = 0;		// Multi_Function Pin Controller (PFSWE Bit Write Disable): 0-enabled, 1-disabled(Valuse after reset)
	MPC.PWPR.BIT.PFSWE = 1;		// Multi_Function Pin Controller (PFS Register Write Enable): 0-disabled(Valuse after reset), 1-enabled

    /* ====================== Port setting ====================== */
    _Port_Init();
    
    /* ====================== 12-bit A/D Converter ====================== */
    _ADC_Init();

    /* ====================== Asynchronous serial interface(UART) ====================== */
    _Uart_Init();

	/* ====================== Software Timer ====================== */
    _TMS_Init();

	/* ====================== Heat Dry Fan PWM ====================== */
    MSTP(MTU4) = 0U;            // Release MTU channel 4 from stop state

    MTU.TRWER.BIT.RWE = 1U;     // Enable read/write to MTU4 registers 
    MTU.TSTR.BIT.CST4 = 0U;     // Stop MTU channel 4 counter 
    MTU.TSYR.BIT.SYNC4 = 0U;    // MTU4.TCNT operates independently
    MTU.TOER.BYTE |= 0xD0;      // ENable MTIOC4C (_D0_MTU_OE4C_ENABLE);
    MTU4.TCR.BYTE = 0xC0;       // _00_MTU_PCLK_1 | _C0_MTU_CKCL_D;
    MTU4.TIER.BYTE = 0x00;		// _00_MTU_TGIEA_DISABLE | _00_MTU_TGIEB_DISABLE | _00_MTU_TGIEC_DISABLE | _00_MTU_TGIED_DISABLE |
 								// _00_MTU_TCIEV_DISABLE | _00_MTU_TTGE_DISABLE;

    MTU4.TMDR.BYTE = 0x02;		// _02_MTU_PWM1;
    MTU4.TIORH.BYTE = 0x00;		// _00_MTU_IOA_DISABLE;
    MTU4.TIORL.BYTE = 0x52;     // Match at TGRC 1 _02_MTU_IOC_LH |
                                // Match at TGRD 0 _50_MTU_IOD_HL;  
    MTU4.TGRC = 1601;
    MTU4.TGRD = 1600;			//50us = 1600/32MHz
   
    MTU.TRWER.BIT.RWE = 0U;		/* Disable read/write to MTU4 registers */

  	/* ====================== Heat Dry Fan FG Timer ====================== */
    MSTP(TMR01) = 0U;           // Cancel TMR module stop state    
    TMR0.TCCR.BYTE = 0x18;      // Counts at TMR1.TCNT overflow signal _18_TMR_CLK_TMR1_OVRF;
    TMR0.TCR.BYTE = 0x20;       // Overflow interrupt requests (OVIn) are enabled // _20_TMR_OVI_INT_ENABLE;  
    TMR1.TCCR.BYTE = 0x0;       //*Stop counting

    /* ====================== Timer for Safety ====================== */
    _Safety_Timer_Setting();

    /* ====================== Interrupt Register ====================== */
    _Interrupt_Setting();

	// 자동세재 세제 투입량 감지 (IRQ3)
    ICU.IER[0x08].BIT.IEN3 = 0U;	// Disable IRQ03 interrupts
    IEN(ICU,SWINT) = 0U;		// Disable software interrupt
    ICU.IRQFLTE0.BIT.FLTEN3 = 0x00;	// Disable IRQ3 digital filter ~(_08_ICU_IRQ3_FILTER_ENABLE);
    ICU.IRQCR[3].BYTE = 0x04;	// Falling Edge             _04_ICU_IRQ_EDGE_FALLING;
    IR(ICU,IRQ3) = 0U;			// Interrupt Request Clear
    IPR(ICU,IRQ3) = 0x01;		// Interrupt Priority : 1 (highest 15)
    IEN(ICU,IRQ3) = 1U;			// Interrupt Enable

	// Heat Dry Fan FG Out Detection (IRQ6)
    ICU.IER[0x08].BIT.IEN6 = 0U;	// Disable IRQ06 interrupts
    IEN(ICU,SWINT) = 0U;		// Disable software interrupt
    ICU.IRQFLTE0.BIT.FLTEN6 = 0x00;	// Disable IRQ6 digital filter ~(_40_ICU_IRQ6_FILTER_ENABLE);
    ICU.IRQCR[6].BYTE = 0x0C;	// Rising and Falling Edge             _0C_ICU_IRQ_EDGE_BOTH;
    IR(ICU,IRQ6) = 0U;			// Interrupt Request Clear
    IPR(ICU,IRQ6) = 0x02;		// Interrupt Priority : 2 (highest 15)
    IEN(ICU,IRQ6) = 1U;			// Interrupt Enable

    // Heat Dry Fan FG Out Detection (Timer0 Overflow)
    IEN(TMR0, OVI0) = 0U;       // Disable TMR0 interrupts
    IPR(TMR0, OVI0) = 0x03;     // Interrupt Priority : 3 (highest 15)
    IR(TMR0, OVI0) = 0U;        // Interrupt Request Clear
    IEN(TMR0, OVI0) = 1U;       // Interrupt Enable

    /* ====================== Watchdog Timer ====================== */
    _Wdt_Init();
}

static void _Wdt_Init(void)
{
    /* Set control registers */
    // WDT Time = 1sec/SystemClk(15KHz)*WDT Clock divide ratio(16) * 2048  = 2.185S
	IWDT.IWDTCR.WORD = 0x3323;	//_0003_IWDT_TIMEOUT_2048 | _0020_IWDT_CLOCK_DIV16 | _0300_IWDT_WINDOW_END_0 |
								//_3000_IWDT_WINDOW_START_100;
	IWDT.IWDTRCR.BYTE = 0x80;	//_80_IWDT_RESET_OUTPUT;
	IWDT.IWDTRR = 0x00;
	IWDT.IWDTRR = 0xFF;
}

static void _TMS_Init(void)
{
    /* Disable CMI0 interrupt */
    IEN(CMT0,CMI0) = 0;

    /* Cancel CMT stop state in LPC */
    MSTP(CMT0) = 0;

    /* Set control registers */
    CMT0.CMCR.WORD = 0x00C0;	//_0000_CMT_CMCR_CLOCK_PCLK8 | _0040_CMT_CMCR_CMIE_ENABLE | _0080_CMT_CMCR_DEFAULT;

    /* Set compare match register */
    CMT0.CMCOR = (2000-1);	//_07CF_CMT0_CMCOR_VALUE;	1sec/32MHz*8*2000 = 500us

    /* Set CMT0 priority level */
    IPR(CMT0, CMI0) = 4; // Interrupt Priority : 4 (highest 15)
}

static void _ADC_Init(void)
{
	/* ====================== 12-bit A/D Converter ====================== */

    MSTP(S12AD) = 0;  /* Cancel S12AD0 module stop state */

    S12AD.ADCSR.BIT.ADIE = 0;    /* Disable and clear interrupt flags of S12AD0 module */
    
    /* Set S12AD0 control registers */
    S12AD.ADCSR.WORD = 0x0000;	//_0000_AD_DBLTRIGGER_DISABLE | _0000_AD_SYNCASYNCTRG_DISABLE | 
                       		//_0000_AD_SCAN_END_INTERRUPT_DISABLE | _0000_AD_SINGLE_SCAN_MODE;

    /* Set channels and sampling time */
    // S12AD.ADANSA0.WORD = 0x00ff;	//_0001_AD_AN000_USED | _0002_AD_AN001_USED | _0004_AD_AN003_USED | _0004_AD_AN002_USED | 
    //                      		//    _0010_AD_AN004_USED | _0020_AD_AN005_USED | _0040_AD_AN006_USED | _0080_AD_AN007_USED;
    S12AD.ADSSTR0 = 0xFC;	//_06_AD0_SAMPLING_STATE_0;
    S12AD.ADSSTR1 = 0xFC;	//_06_AD0_SAMPLING_STATE_1;
    S12AD.ADSSTR2 = 0xFC;	//_06_AD0_SAMPLING_STATE_2;
    S12AD.ADSSTR3 = 0xFC;	//_06_AD0_SAMPLING_STATE_3;
    S12AD.ADSSTR4 = 0xFC;	//_06_AD0_SAMPLING_STATE_4;
    S12AD.ADSSTR5 = 0xFC;	//_06_AD0_SAMPLING_STATE_5;
    S12AD.ADSSTR6 = 0xFC;	//_06_AD0_SAMPLING_STATE_6;
    S12AD.ADSSTR7 = 0xFC;	//_06_AD0_SAMPLING_STATE_7;
    S12AD.ADSSTRL = 0xFC;	//_06_AD0_SAMPLING_STATE_16_31;
}

static void _Interrupt_Setting(void)
{
	/* Clear interrupt flag */
    IR(SCI1, TXI1) = 0;
    IR(SCI1, RXI1) = 0;
    /* Enable SCI interrupt */
    IEN(SCI1, TXI1) = 1;
    // IEN(SCI1, TEI1) = 1;
    IEN(SCI1, RXI1) = 1;
    // IEN(SCI1, ERI1) = 1;

    /* Clear interrupt flag */
    IR(SCI5, TXI5) = 0;
    IR(SCI5, RXI5) = 0;
    /* Enable SCI interrupt */
    IEN(SCI5, TXI5) = 1;
    // IEN(SCI5, TEI5) = 1;
    IEN(SCI5, RXI5) = 1;
    // IEN(SCI5, ERI5) = 1;

    /* Clear interrupt flag */
    IR(SCI0, TXI0) = 0;
    IR(SCI0, RXI0) = 0;
    /* Enable SCI interrupt */
    IEN(SCI0, TXI0) = 1;
    // IEN(SCI5, TEI5) = 1;
    IEN(SCI0, RXI0) = 1;
    // IEN(SCI5, ERI5) = 1;

    /* Enable CMI0 interrupt in ICU */
    IEN(CMT0,CMI0) = 1;
    /* Start CMT0 count */
    CMT.CMSTR0.BIT.STR0 = 1;
}

static void _Port_Init(void)
{
	/*
	 * Pin		I/O			MFP			Description
	 * x
	 * x
	 * x
	 * P03		Input		x			Unused(Pull-down)
	 * P04		Input		x			Unused(Pull-down)
	 * P05		Input		x			Unused(Pull-down)
	 * P06		Input		x			Unused(Pull-down)
	 * P07		Input		x			Unused(Pull-down)
	 */
	PORT0.PODR.BYTE = 0x00;				// 0000 0000
	PORT0.PMR.BYTE = 0x00;				// 0000 0000 (GPIO_ADC_IRQ 0, 이외 특수기능 1, * GPIO가 아닐경우 PDR, PODR 안먹힘)
	PORT0.PDR.BYTE = 0x07;				// 0000 0111 (미할당 출력 1, 할당 미사용 핀 풀업 풀다운 있으면 입력 0 풀업 풀다운 저항이 없을시 OPEN)

	/*
	 * Pin		I/O			MFP			Description
	 * x
	 * x
	 * P12		Input		x			Unused(Pull-down)
	 * P13		Input		x			Unused(Pull-down)
	 * P14		Output		x			Vario Motor
	 * P15		Output		x			Aqua-Stop
	 * P16		Output		x			AOD Open
	 * P17		Input		x			Heat Dry Door Sensing
	 */
	PORT1.PODR.BYTE = 0x00;				// 0000 0000
	PORT1.PMR.BYTE = 0x00;				// 0000 0000
	PORT1.PDR.BYTE = 0x73;				// 0111 0011

	/*
	 * Pin		I/O			MFP			Description
	 * P20		Output		x			TXD0(디지털 탁도센서)
	 * P21		Input		x			RXD0(디지털 탁도센서)
	 * P22		Input		x			Unused(Pull-down)
	 * P23		Input		x			Unused(Pull-down)
	 * P24		Input		x			Unused(Pull-down)
	 * P25		Input		x			Unused(Pull-down)
	 * P26		Output		TXD1		TXD1(display)
	 * P27		Input		x			Unused(Pull-down)
	 */
	PORT2.PODR.BYTE = 0x41;				// 0100 0001
	PORT2.PMR.BYTE = 0x43;				// 0100 0011
	PORT2.PDR.BYTE = 0x41;				// 0100 0001

	MPC.P20PFS.BIT.PSEL = 0x0A;			/* Set TXD0 pin */
	MPC.P21PFS.BIT.PSEL = 0x0A;			/* Set RXD0 pin */
	MPC.P26PFS.BIT.PSEL = 0x0A;			/* Set TXD1 pin */

	/*
	 * Pin		I/O			MFP			Description
	 * P30		Input		RXD1		RXD1(display)
	 * P31		Input		x			Unused(Pull-down)
	 * P32		Input		x			Unused(Pull-down)
	 * P33		Input		IRQ3		자동세제 세제 투입량 감지
	 * P34		Input		x			자동세제 세제 잔량 감지
	 * P35		Input		x			Door Sensing1(DC)
	 * P36		Input					EXTAL
	 * P37		Input					XTAL
	 */
	PORT3.PODR.BYTE = 0x00;				// 0000 0000
	PORT3.PMR.BYTE = 0x01;				// 0000 0001
	PORT3.PDR.BYTE = 0x00;				// 0000 0000

	MPC.P30PFS.BIT.PSEL = 0x0A;			/* Set RXD1 pin */
	MPC.P33PFS.BIT.ISEL = 0x01;			/* Set IRQ3 pin */

	/*
	 * Pin		I/O			MFP			Description
	 * P40		Input		AN000		Turbidity Sensing
	 * P41		Input		AN001		HeatDry Temperature Sensing
	 * P42		Input		AN002		Sump Temperature Sensing
	 * P43		Input		AN003		Steam Temperature Sensing
	 * P44		Input		x			Steam Water
	 * P45		Input		x			Unused(Pull-down)
	 * P46		Input		x			Unused(Pull-down)
	 * P47		Input		x			Unused(Pull-down)
	 */
	PORT4.PMR.BYTE = 0x00;				// 0000 0000
	PORT4.PDR.BYTE = 0x00;				// 0000 0000

	/* Set AN000 pin */
	MPC.P40PFS.BIT.ASEL = 0x01;
	MPC.P41PFS.BIT.ASEL = 0x01;
	MPC.P42PFS.BIT.ASEL = 0x01;
	MPC.P43PFS.BIT.ASEL = 0x01;
	
	/*
	 * Pin		I/O			MFP			Description
	 * P50		Input		x			Unused(Pull-down)
	 * P51		Input		x			Unused(Pull-down)
	 * P52		Input		x			Unused(Pull-down)
	 * P53		Input		x			Unused(Pull-down)
	 * P54		Input		x			Flow Meter Sensing
	 * P55		Input		x			AOD Close Sensing
	 * X
	 * X
	 */
	PORT5.PMR.BYTE = 0x00;				// 0000 0000
	PORT5.PDR.BYTE = 0xC0;				// 1100 0000

	/*
	 * Pin		I/O			MFP			Description
	 * PA0		Output		x			Water Jacket V/V(WW Only)
	 * PA1		Input		x			Unused(Pull-down)
	 * PA2		Input		x			Unused(Pull-down)
	 * PA3		Input       IRQ6        Heat Dry FAN FG Out
	 * PA4		Input		x			Unused(Pull-down)
	 * PA5		Input		x			Unused(Pull-down)
	 * PA6		Output		x			AOD Enable
	 * PA7		Input		x			Unused(Pull-down)
	 */
	PORTA.PODR.BYTE = 0x40;				// 0100 0000 (AOD Enable OUT)
	PORTA.PMR.BYTE = 0x00;				// 0000 0000
	PORTA.PDR.BYTE = 0x41;				// 0100 0001

	MPC.PA3PFS.BIT.ISEL = 0x01;			/* Set IRQ6 pin */

	/*
	 * Pin		I/O			MFP			Description
	 * PB0		Output		x			Unused(Open), reserved as UP가전 RXD6
	 * PB1		Output		x			Unused(Open), reserved as UP가전 TXD6
	 * PB2		Input		x			Unused(Pull-down)
	 * PB3		Output		x			Tub Lamp
	 * PB4		Output		x			Steam Valve
	 * PB5		Output		x			Regen Valve
	 * PB6		Input		x			Door Sensing2(DC)
	 * PB7		Input		x			Vario Switch
	 */
	PORTB.PODR.BYTE = 0x00;				// 0000 0000
	PORTB.PMR.BYTE = 0x00;				// 0000 0000
	PORTB.PDR.BYTE = 0x3B;				// 0011 1011

	/*
	 * Pin		I/O			MFP			Description
	 * PC0		Input		x			Unused(Pull-down)
	 * PC1		Input		x			Unused(Pull-down)
	 * PC2		Input		RXD5		RXD5(INV)
	 * PC3		Output		TXD5		TXD5(INV)
	 * PC4		Output		x			AOD Close
	 * PC5		Output		x			Turbidity TR
	 * PC6		Input		x			Softner meter(Salt refill)
	 * PC7		Output		x			Dispenser
	 */
	PORTC.PODR.BYTE = 0x08;				// 0000 1000
	PORTC.PMR.BYTE = 0x0C;				// 0000 1100
	PORTC.PDR.BYTE = 0xB8;				// 1011 1000

	MPC.PC2PFS.BIT.PSEL = 0x0A;			/* Set RXD5 pin */
	MPC.PC3PFS.BIT.PSEL = 0x0A;			/* Set TXD5 pin */

	/*
	 * Pin		I/O			MFP			Description
	 * PD0		Input		x			Unused(Pull-down)
	 * PD1		Input		x			Unused(Pull-down)
	 * PD2		Input		x			Unused(Pull-down)
	 * PD3		Input		AN027		AD Option 1
	 * PD4		Input		AN028		AD Option 2
	 * PD5		Input		AN029		AD Option 3
	 * PD6		Input		x			Unused(Pull-down)
	 * PD7		Input		x			Unused(Pull-down)
	 */
	PORTD.PMR.BYTE = 0x00;				// 0000 0000
	PORTD.PDR.BYTE = 0x00;				// 0000 0000

	/* Set AN001 pin */
	MPC.PD3PFS.BIT.ASEL = 0x01;
	MPC.PD4PFS.BIT.ASEL = 0x01;
	MPC.PD5PFS.BIT.ASEL = 0x01;

	/*
	 * Pin		I/O			MFP			Description
	 * PE0		Input		x			Unused(Pull-down)
	 * PE1		Input		x			Unused(Pull-down)
	 * PE2		Input		x			Unused(Pull-down)
	 * PE3		Output		x			Inverter 15V
	 * PE4		Output		x			Main 12V
	 * PE5		Output		MTIOC4C		Heat Dry Fan PWM
	 * PE6		Input		x			Unused(Pull-down)
	 * PE7		Input		x			Unused(Pull-down)
	 */
	PORTE.PODR.BYTE = 0x18;				// 0001 1000 (Main 12V, Inverter 15V)
	PORTE.PMR.BYTE = 0x20;				// 0010 0000
	PORTE.PDR.BYTE = 0x38;				// 0011 1000

	MPC.PE5PFS.BIT.PSEL = 0x01;			// MTIOC4C

	/*
	 * Pin		I/O			MFP			Description
	 * PH0		Input		x			Rinse_refill_sensing
	 * PH1		Output		x			Main Relay
	 * PH2		Input		x			Unused(Pull-down)
	 * PH3		Input		x			Unused(Pull-down)
	 * x
	 * x
	 * x
	 * x
	 */
	PORTH.PODR.BYTE = 0x02;				// 0000 0010 (Power Relay On)
	PORTH.PMR.BYTE = 0x00;				// 0000 0000
	PORTH.PDR.BYTE = 0xF2;				// 1111 0010

	/*
	 * Pin		I/O			MFP			Description
	 * x
	 * PJ1		Output		x			자동세제 Motor 지령 1 (CCW)
	 * x
	 * PJ3		Output		x			자동세제 Motor 지령 2 (CW)
	 * x
	 * x
	 * PJ6		Input		x			Unused(Pull-down)
	 * PJ7		Input		x			Unused(Pull-down)
	 */
	PORTJ.PODR.BYTE = 0x00;				// 0000 0000
	PORTJ.PMR.BYTE = 0x00;				// 0000 0000
	PORTJ.PDR.BYTE = 0x3A;				// 0011 1010
}

static void _Uart_Init(void)
{
    /* Cancel SCI1 stop state */
    MSTP(SCI1) = 0;

    /* Set interrupt priority */
    IPR(SCI1, TXI1) = 6;	//Interrupt Priority : 6 (highest 15)
    IPR(SCI1, RXI1) = 6;	//Interrupt Priority : 6 (highest 15)

    /* Clear the control register */
    SCI1.SCR.BYTE = 0x00;

    /* Clear the SIMR1.IICM, SPMR.CKPH, and CKPOL bit, and set SPMR */
    SCI1.SIMR1.BIT.IICM = 0;
    SCI1.SPMR.BYTE = 0x00;	//_00_SCI_RTS | _00_SCI_CLOCK_NOT_INVERTED | _00_SCI_CLOCK_NOT_DELAYED;

    /* Set control registers */
    SCI1.SMR.BYTE = 0x01;	//_01_SCI_CLOCK_PCLK_4 | _00_SCI_MULTI_PROCESSOR_DISABLE | _00_SCI_STOP_1 |
                    		//_00_SCI_PARITY_DISABLE | _00_SCI_DATA_LENGTH_8 | _00_SCI_ASYNCHRONOUS_OR_I2C_MODE;
    SCI1.SCMR.BYTE = 0x72;	//_00_SCI_SERIAL_MODE | _00_SCI_DATA_INVERT_NONE | _00_SCI_DATA_LSB_FIRST | 
                     		//_10_SCI_DATA_LENGTH_8_OR_7 | _62_SCI_SCMR_DEFAULT;
    SCI1.SEMR.BYTE = 0x00;	//_00_SCI_BIT_MODULATION_DISABLE | _00_SCI_16_BASE_CLOCK | _00_SCI_NOISE_FILTER_DISABLE |
                     		//_00_SCI_BAUDRATE_SINGLE | _00_SCI_LOW_LEVEL_START_BIT;

    /* Set bit rate */
    SCI1.BRR = 0x0C;		// 32MHz/(64*2*19200))-1 = 12 (Error : 0.16% (((32*1000000)/(19200*64*2*(12+1))-1)*100))

    /*SCI1 TX enable*/
    SCI1.SCR.BIT.TIE = 1;
    SCI1.SCR.BIT.TE = 1;

    /*SCI1 RX enable*/
    SCI1.SCR.BIT.RIE = 1;
    SCI1.SCR.BIT.RE = 1;


    /* Cancel SCI5 stop state */
    MSTP(SCI5) = 0;

    /* Set interrupt priority */
    IPR(SCI5, TXI5) = 6;	//Interrupt Priority : 6 (highest 15)
    IPR(SCI5, RXI5) = 6;	//Interrupt Priority : 6 (highest 15)

    /* Clear the control register */
    SCI5.SCR.BYTE = 0x00;

    /* Clear the SIMR1.IICM, SPMR.CKPH, and CKPOL bit, and set SPMR */
    SCI5.SIMR1.BIT.IICM = 0;
    SCI5.SPMR.BYTE = 0x00;	//_00_SCI_RTS | _00_SCI_CLOCK_NOT_INVERTED | _00_SCI_CLOCK_NOT_DELAYED;

    /* Set control registers */
    SCI5.SMR.BYTE = 0x01;	//_01_SCI_CLOCK_PCLK_4 | _00_SCI_MULTI_PROCESSOR_DISABLE | _00_SCI_STOP_1 |
                    		//_00_SCI_PARITY_DISABLE | _00_SCI_DATA_LENGTH_8 | _00_SCI_ASYNCHRONOUS_OR_I2C_MODE;
    SCI5.SCMR.BYTE = 0x72;	//_00_SCI_SERIAL_MODE | _00_SCI_DATA_INVERT_NONE | _00_SCI_DATA_LSB_FIRST | 
                     		//_10_SCI_DATA_LENGTH_8_OR_7 | _62_SCI_SCMR_DEFAULT;
    SCI5.SEMR.BYTE = 0x00;	//_00_SCI_BIT_MODULATION_DISABLE | _00_SCI_16_BASE_CLOCK | _00_SCI_NOISE_FILTER_DISABLE |
                     		//_00_SCI_BAUDRATE_SINGLE | _00_SCI_LOW_LEVEL_START_BIT;

    /* Set bit rate */
    SCI5.BRR = 0x0C;

    /*SCI5 TX enable*/
    SCI5.SCR.BIT.TIE = 1;
    SCI5.SCR.BIT.TE = 1;

    /*SCI5 RX enable*/
    SCI5.SCR.BIT.RIE = 1;
    SCI5.SCR.BIT.RE = 1;


    /* Cancel SCI0 stop state */
	MSTP(SCI0) = 0;

	/* Set interrupt priority */
	IPR(SCI0, TXI0) = 5;	//Interrupt Priority : 5 (highest 15)
	IPR(SCI0, RXI0) = 5;	//Interrupt Priority : 5 (highest 15)

	/* Clear the control register */
	SCI0.SCR.BYTE = 0x00;

	/* Clear the SIMR1.IICM, SPMR.CKPH, and CKPOL bit, and set SPMR */
	SCI0.SIMR1.BIT.IICM = 0;
	SCI0.SPMR.BYTE = 0x00;	//_00_SCI_RTS | _00_SCI_CLOCK_NOT_INVERTED | _00_SCI_CLOCK_NOT_DELAYED;

	/* Set control registers */
	SCI0.SMR.BYTE = 0x01;	//_01_SCI_CLOCK_PCLK_4 | _00_SCI_MULTI_PROCESSOR_DISABLE | _00_SCI_STOP_1 |
							//_00_SCI_PARITY_DISABLE | _00_SCI_DATA_LENGTH_8 | _00_SCI_ASYNCHRONOUS_OR_I2C_MODE;
	SCI0.SCMR.BYTE = 0x72;	//_00_SCI_SERIAL_MODE | _00_SCI_DATA_INVERT_NONE | _00_SCI_DATA_LSB_FIRST |
							//_10_SCI_DATA_LENGTH_8_OR_7 | _62_SCI_SCMR_DEFAULT;
	SCI0.SEMR.BYTE = 0x00;	//_00_SCI_BIT_MODULATION_DISABLE | _00_SCI_16_BASE_CLOCK | _00_SCI_NOISE_FILTER_DISABLE |
							//_00_SCI_BAUDRATE_SINGLE | _00_SCI_LOW_LEVEL_START_BIT;

	/* Set bit rate */
	SCI0.BRR = 0x19;		// (32*1000000)/(64*2*9600))-1 = 25 (Error : 0.16% (((32*1000000)/(9600*64*2*(25+1))-1)*100))

	/*SCI0 TX enable*/
	SCI0.SCR.BIT.TIE = 1;
	SCI0.SCR.BIT.TE = 1;

	/*SCI0 RX enable*/
	SCI0.SCR.BIT.RIE = 1;
	SCI0.SCR.BIT.RE = 1;
}


// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
// WatchDog Driver
// $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$
/**
* @fn void WatchDogClear_Driver(void)
* WatchDog Timer를 Clear 한다.
* @param	없음
* @return	없음
*/
void WatchDogClear_Driver(void)
{
    /* Refreshed by writing 00h and then writing FFh */
    IWDT.IWDTRR = 0x00;
    IWDT.IWDTRR = 0xFF;
}

/**
* @fn void UnusedPin_Disable(T_Context* pstContext)
* 미사용 포트 Disable 작업.
*
* @param	: pstContext : 구조체 정보
*/
void UnusedPin_Disable(T_Context* pstContext)
{
    if(pstContext->bAutoOpenDoorProductF == FALSE)
	{
        /*
         * Pin		I/O				MFP			Description
         * PC4		Output->Input	x			AOD Close
         * P16		Output->Input	x			AOD Open
		 * PA6		Output->Input	x			AOD Enable
         */
        PORTC.PDR.BIT.B4 = 0x00;
        PORT1.PDR.BIT.B6 = 0x00;

		PORTA.PODR.BIT.B6 = 0x00;			//AOD 없을시 Enable신호 LOW
		PORTA.PDR.BIT.B6 = 0x00;			//AOD 없을시 Enable신호 Input
    }
	else
	{
		;	///< Do Nothing
	}

	if(pstContext->bTubLampProductF == FALSE)
    {
        /*
         * Pin		I/O				MFP			Description
         * PB3		Output->Input	x			TUB Lamp
         */
        PORTB.PDR.BIT.B3 = 0x00;
    }
    else
	{
		;	///< Do Nothing
	}

	if(pstContext->bHeatDryProductF == FALSE)
	{
        /*
         * Pin		I/O				MFP			Description
         * PE5		Output->Input	MTIOC4C->x	Heat Dry Fan PWM(VSP)
         */
        PORTE.PDR.BIT.B5 = 0x00;
        PORTE.PMR.BIT.B5 = 0x00;
        MPC.PE5PFS.BIT.PSEL = 0x00;

        // Heat Dry Fan FG Out Detection (IRQ6)
        IEN(ICU, IRQ6) = 0U;   // Interrupt Disable
        IR(ICU, IRQ6) = 0U;    // Interrupt Request Clear
        IPR(ICU, IRQ6) = 0x00; // Interrupt Priority : 0 (highest 15)

        // Heat Dry Fan FG Out Detection (Timer0 Overflow)
        IEN(TMR0, OVI0) = 0U;   // Interrupt Disable
        IR(TMR0, OVI0) = 0U;    // Interrupt Request Clear
        IPR(TMR0, OVI0) = 0x00; // Interrupt Priority : 0 (highest 15)
    }
    else
    {
        ;		// Do nothing
    }
}

/**
* @fn void RESET(void)
*  Software Reset 수행
* @param	없음
* @return	없음
* @see
*/
#ifndef __SILS__
void RESET(void)
{
    SYSTEM.PRCR.WORD = 0xA50F;
	SYSTEM.SWRR = 0xA501;
}
#endif

/**
* @fn static void _Safety_Timer_Setting(void)
*  Safety Software Timer 설정
* @param	없음
* @return	없음
* @see
*/
static void _Safety_Timer_Setting(void)		//2ms
{
    /* Disable CMI1 interrupt */
    IEN(CMT1, CMI1) = 0;

    /* Cancel CMT stop state in LPC */
    MSTP(CMT1) = 0;

    /* Set control registers */
    CMT1.CMCR.WORD = 0x00C0; //_0000_CMT_CMCR_CLOCK_PCLK8 | _0040_CMT_CMCR_CMIE_ENABLE | _0080_CMT_CMCR_DEFAULT;

    /* Set compare match register */
    CMT1.CMCOR = (8000 - 1); //_1F3F_CMT1_CMCOR_VALUE; 1sec/32MHz*8*8000 = 2ms

    /* Set CMI1 priority level */
    IPR(CMT1, CMI1) = 10; //Interrupt Priority : 10 (highest 15)

    /* Enable CMI1 interrupt in ICU */
    IEN(CMT1, CMI1) = 1;

    /* Start CMT0 count */
    CMT.CMSTR0.BIT.STR1 = 1;
}

/* End of File */
