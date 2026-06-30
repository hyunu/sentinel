// Serial Packet Parser - Go 구현
// 규칙 기반으로 어떤 구조의 시리얼 패킷이든 파싱 가능한 모듈.
package ruleparser

import (
	"encoding/binary"
	"fmt"
	"math"
)

// ============================================================================
// Errors
// ============================================================================

type ParseError struct {
	Message string
	Offset  int
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("[offset=%d] %s", e.Offset, e.Message)
}

func newParseError(offset int, format string, args ...interface{}) *ParseError {
	return &ParseError{
		Message: fmt.Sprintf(format, args...),
		Offset:  offset,
	}
}

// ============================================================================
// Parse Context
// ============================================================================

type ParseContext struct {
	Data     []byte
	Offset   int
	Results  map[string]interface{}
	Internal map[string]interface{} // hidden ?꾨뱶 ???(寃곌낵??誘명룷??
	Parent   *ParseContext
}

func NewParseContext(data []byte) *ParseContext {
	return &ParseContext{
		Data:     data,
		Offset:   0,
		Results:  make(map[string]interface{}),
		Internal: make(map[string]interface{}),
	}
}

func (ctx *ParseContext) Remaining() int {
	return len(ctx.Data) - ctx.Offset
}

func (ctx *ParseContext) IsExhausted() bool {
	return ctx.Offset >= len(ctx.Data)
}

func (ctx *ParseContext) Read(n int) ([]byte, error) {
	if ctx.Offset+n > len(ctx.Data) {
		return nil, newParseError(ctx.Offset, "?곗씠??遺議? %d諛붿씠???꾩슂, %d諛붿씠???⑥쓬", n, ctx.Remaining())
	}
	result := make([]byte, n)
	copy(result, ctx.Data[ctx.Offset:ctx.Offset+n])
	ctx.Offset += n
	return result, nil
}

func (ctx *ParseContext) Peek(n int) []byte {
	end := ctx.Offset + n
	if end > len(ctx.Data) {
		end = len(ctx.Data)
	}
	return ctx.Data[ctx.Offset:end]
}

func (ctx *ParseContext) ReadUntil(delimiter []byte) ([]byte, error) {
	for i := ctx.Offset; i <= len(ctx.Data)-len(delimiter); i++ {
		match := true
		for j := 0; j < len(delimiter); j++ {
			if ctx.Data[i+j] != delimiter[j] {
				match = false
				break
			}
		}
		if match {
			result := make([]byte, i-ctx.Offset)
			copy(result, ctx.Data[ctx.Offset:i])
			ctx.Offset = i + len(delimiter)
			return result, nil
		}
	}
	return nil, newParseError(ctx.Offset, "援щ텇?먮? 李얠쓣 ???놁쓬")
}

func (ctx *ParseContext) ResolveRef(ref string) (interface{}, error) {
	if val, ok := ctx.Results[ref]; ok {
		return val, nil
	}
	if val, ok := ctx.Internal[ref]; ok {
		return val, nil
	}
	if ctx.Parent != nil {
		return ctx.Parent.ResolveRef(ref)
	}
	return nil, newParseError(ctx.Offset, "reference field not found: '%s'", ref)
}

func (ctx *ParseContext) ExprVars() map[string]interface{} {
	var chain []*ParseContext
	for c := ctx; c != nil; c = c.Parent {
		chain = append(chain, c)
	}
	vars := make(map[string]interface{})
	for i := len(chain) - 1; i >= 0; i-- {
		for k, v := range chain[i].Internal {
			vars[k] = v
		}
		for k, v := range chain[i].Results {
			vars[k] = v
		}
	}
	return vars
}

func (ctx *ParseContext) ChildContext(data []byte) *ParseContext {
	if data != nil {
		return &ParseContext{Data: data, Offset: 0, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
	}
	return &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
}

// ============================================================================
// Endian
// ============================================================================

type Endian int

const (
	LittleEndian Endian = iota
	BigEndian
)

// ============================================================================
// Length Resolver
// ============================================================================

type LengthRef interface {
	Resolve(ctx *ParseContext) (int, error)
}

type FieldRef struct {
	Name string
}

func (r FieldRef) Resolve(ctx *ParseContext) (int, error) {
	val, err := ctx.ResolveRef(r.Name)
	if err != nil {
		return 0, err
	}
	return toInt(val)
}

type FuncRef struct {
	Fn func(ctx *ParseContext) int
}

func (r FuncRef) Resolve(ctx *ParseContext) (int, error) {
	return r.Fn(ctx), nil
}

// ?몄쓽 ?⑥닔
func FromField(name string) LengthRef { return FieldRef{Name: name} }
func FromFunc(fn func(ctx *ParseContext) int) LengthRef { return FuncRef{Fn: fn} }

func toInt(val interface{}) (int, error) {
	switch v := val.(type) {
	case int:
		return v, nil
	case int8:
		return int(v), nil
	case int16:
		return int(v), nil
	case int32:
		return int(v), nil
	case int64:
		return int(v), nil
	case uint8:
		return int(v), nil
	case uint16:
		return int(v), nil
	case uint32:
		return int(v), nil
	case uint64:
		return int(v), nil
	default:
		return 0, fmt.Errorf("?뺤닔濡?蹂?섑븷 ???놁쓬: %v", val)
	}
}

// ============================================================================
// Field Type Interface
// ============================================================================

type FieldType interface {
	Parse(ctx *ParseContext) (interface{}, error)
}

// ============================================================================
// Primitive Types
// ============================================================================

type TypeU8 struct{}

func (t TypeU8) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(1)
	if err != nil {
		return nil, err
	}
	return int(data[0]), nil
}

type TypeU16 struct {
	Endian Endian
}

func (t TypeU16) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(2)
	if err != nil {
		return nil, err
	}
	if t.Endian == BigEndian {
		return int(binary.BigEndian.Uint16(data)), nil
	}
	return int(binary.LittleEndian.Uint16(data)), nil
}

type TypeU32 struct {
	Endian Endian
}

func (t TypeU32) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(4)
	if err != nil {
		return nil, err
	}
	if t.Endian == BigEndian {
		return int(binary.BigEndian.Uint32(data)), nil
	}
	return int(binary.LittleEndian.Uint32(data)), nil
}

type TypeI8 struct{}

func (t TypeI8) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(1)
	if err != nil {
		return nil, err
	}
	return int(int8(data[0])), nil
}

type TypeI16 struct {
	Endian Endian
}

func (t TypeI16) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(2)
	if err != nil {
		return nil, err
	}
	if t.Endian == BigEndian {
		return int(int16(binary.BigEndian.Uint16(data))), nil
	}
	return int(int16(binary.LittleEndian.Uint16(data))), nil
}

type TypeI32 struct {
	Endian Endian
}

func (t TypeI32) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(4)
	if err != nil {
		return nil, err
	}
	if t.Endian == BigEndian {
		return int(int32(binary.BigEndian.Uint32(data))), nil
	}
	return int(int32(binary.LittleEndian.Uint32(data))), nil
}

type TypeFloat struct {
	Endian Endian
}

func (t TypeFloat) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(4)
	if err != nil {
		return nil, err
	}
	var bits uint32
	if t.Endian == BigEndian {
		bits = binary.BigEndian.Uint32(data)
	} else {
		bits = binary.LittleEndian.Uint32(data)
	}
	return float64(math.Float32frombits(bits)), nil
}

type TypeBool struct{}

func (t TypeBool) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(1)
	if err != nil {
		return nil, err
	}
	return data[0] != 0, nil
}

// ============================================================================
// Fixed-Length Types
// ============================================================================

type TypeFixed struct {
	Size int
}

func (t TypeFixed) Parse(ctx *ParseContext) (interface{}, error) {
	return ctx.Read(t.Size)
}

type TypeString struct {
	Size int
}

func (t TypeString) Parse(ctx *ParseContext) (interface{}, error) {
	data, err := ctx.Read(t.Size)
	if err != nil {
		return nil, err
	}
	// null 臾몄옄 ?쒓굅
	end := len(data)
	for i := 0; i < len(data); i++ {
		if data[i] == 0 {
			end = i
			break
		}
	}
	return string(data[:end]), nil
}

type TypePadding struct {
	Size int
}

func (t TypePadding) Parse(ctx *ParseContext) (interface{}, error) {
	_, err := ctx.Read(t.Size)
	return nil, err
}

// ============================================================================
// Variable-Length Types
// ============================================================================

type TypeVarBytes struct {
	LengthFrom LengthRef
}

func (t TypeVarBytes) Parse(ctx *ParseContext) (interface{}, error) {
	length, err := t.LengthFrom.Resolve(ctx)
	if err != nil {
		return nil, err
	}
	return ctx.Read(length)
}

type TypeVarString struct {
	LengthFrom LengthRef
}

func (t TypeVarString) Parse(ctx *ParseContext) (interface{}, error) {
	length, err := t.LengthFrom.Resolve(ctx)
	if err != nil {
		return nil, err
	}
	data, err := ctx.Read(length)
	if err != nil {
		return nil, err
	}
	return string(data), nil
}

type TypeUntil struct {
	Delimiter []byte
}

func (t TypeUntil) Parse(ctx *ParseContext) (interface{}, error) {
	return ctx.ReadUntil(t.Delimiter)
}

type TypeUntilEnd struct{}

func (t TypeUntilEnd) Parse(ctx *ParseContext) (interface{}, error) {
	return ctx.Read(ctx.Remaining())
}

type TypeLengthPrefixed struct {
	LenType FieldType
}

func (t TypeLengthPrefixed) Parse(ctx *ParseContext) (interface{}, error) {
	lenVal, err := t.LenType.Parse(ctx)
	if err != nil {
		return nil, err
	}
	length, err := toInt(lenVal)
	if err != nil {
		return nil, err
	}
	return ctx.Read(length)
}

// ============================================================================
// Repeat Types
// ============================================================================

type TypeArray struct {
	ItemType  FieldType
	CountFrom LengthRef
}

func (t TypeArray) Parse(ctx *ParseContext) (interface{}, error) {
	count, err := t.CountFrom.Resolve(ctx)
	if err != nil {
		return nil, err
	}
	results := make([]interface{}, 0, count)
	for i := 0; i < count; i++ {
		val, err := t.ItemType.Parse(ctx)
		if err != nil {
			return nil, err
		}
		results = append(results, val)
	}
	return results, nil
}

type TypeRepeatCount struct {
	ItemRules []*Field
	CountFrom LengthRef
}

func (t TypeRepeatCount) Parse(ctx *ParseContext) (interface{}, error) {
	count, err := t.CountFrom.Resolve(ctx)
	if err != nil {
		return nil, err
	}
	results := make([]map[string]interface{}, 0, count)
	for i := 0; i < count; i++ {
		itemCtx := &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
		for _, f := range t.ItemRules {
			if err := f.ParseInto(itemCtx); err != nil {
				return nil, err
			}
		}
		ctx.Offset = itemCtx.Offset
		results = append(results, itemCtx.Results)
	}
	return results, nil
}

type TypeRepeatUntilEnd struct {
	ItemRules []*Field
}

func (t TypeRepeatUntilEnd) Parse(ctx *ParseContext) (interface{}, error) {
	results := make([]map[string]interface{}, 0)
	for !ctx.IsExhausted() {
		itemCtx := &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
		parseOk := true
		for _, f := range t.ItemRules {
			if err := f.ParseInto(itemCtx); err != nil {
				parseOk = false
				break
			}
		}
		if !parseOk {
			break
		}
		ctx.Offset = itemCtx.Offset
		results = append(results, itemCtx.Results)
	}
	return results, nil
}

type TypeRepeatUntil struct {
	ItemRules []*Field
	Predicate func(ctx *ParseContext, item map[string]interface{}) bool
}

func (t TypeRepeatUntil) Parse(ctx *ParseContext) (interface{}, error) {
	results := make([]map[string]interface{}, 0)
	for !ctx.IsExhausted() {
		itemCtx := &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
		for _, f := range t.ItemRules {
			if err := f.ParseInto(itemCtx); err != nil {
				return nil, err
			}
		}
		ctx.Offset = itemCtx.Offset
		results = append(results, itemCtx.Results)
		if t.Predicate(ctx, itemCtx.Results) {
			break
		}
	}
	return results, nil
}

// ============================================================================
// Conditional Types
// ============================================================================

type TypeSwitch struct {
	KeyFrom string
	Cases   map[interface{}][]*Field
	Default []*Field
}

func (t TypeSwitch) Parse(ctx *ParseContext) (interface{}, error) {
	key, err := ctx.ResolveRef(t.KeyFrom)
	if err != nil {
		return nil, err
	}
	rules, ok := t.Cases[key]
	if !ok {
		if t.Default != nil {
			rules = t.Default
		} else {
			return nil, newParseError(ctx.Offset, "Switch: 留ㅼ묶?섎뒗 case ?놁쓬 (key=%v)", key)
		}
	}
	subCtx := &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
	for _, f := range rules {
		if err := f.ParseInto(subCtx); err != nil {
			return nil, err
		}
	}
	ctx.Offset = subCtx.Offset
	return subCtx.Results, nil
}

type TypeIf struct {
	Predicate func(ctx *ParseContext) bool
	ThenRules []*Field
	ElseRules []*Field
}

func (t TypeIf) Parse(ctx *ParseContext) (interface{}, error) {
	var rules []*Field
	if t.Predicate(ctx) {
		rules = t.ThenRules
	} else {
		rules = t.ElseRules
	}
	subCtx := &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
	for _, f := range rules {
		if err := f.ParseInto(subCtx); err != nil {
			return nil, err
		}
	}
	ctx.Offset = subCtx.Offset
	return subCtx.Results, nil
}

type TypeOptional struct {
	Rules     []*Field
	Predicate func(ctx *ParseContext) bool
}

func (t TypeOptional) Parse(ctx *ParseContext) (interface{}, error) {
	if !t.Predicate(ctx) {
		return nil, nil
	}
	subCtx := &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
	for _, f := range t.Rules {
		if err := f.ParseInto(subCtx); err != nil {
			return nil, err
		}
	}
	ctx.Offset = subCtx.Offset
	return subCtx.Results, nil
}

// ============================================================================
// Nested Types
// ============================================================================

type TypeStruct struct {
	Fields []*Field
}

func (t TypeStruct) Parse(ctx *ParseContext) (interface{}, error) {
	subCtx := &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
	for _, f := range t.Fields {
		if err := f.ParseInto(subCtx); err != nil {
			return nil, err
		}
	}
	ctx.Offset = subCtx.Offset
	return subCtx.Results, nil
}

type TypeNested struct {
	Parser *PacketParser
}

func (t TypeNested) Parse(ctx *ParseContext) (interface{}, error) {
	subCtx := &ParseContext{Data: ctx.Data, Offset: ctx.Offset, Results: make(map[string]interface{}), Internal: make(map[string]interface{}), Parent: ctx}
	result, err := t.Parser.parseWithContext(subCtx)
	if err != nil {
		return nil, err
	}
	ctx.Offset = subCtx.Offset
	return result, nil
}

// ============================================================================
// Bit-Level Types
// ============================================================================

type BitFieldDef struct {
	Name string
	Bits int
}

type TypeBits struct {
	Definitions []BitFieldDef
	TotalBits   int
}

func NewTypeBits(defs []BitFieldDef) TypeBits {
	total := 0
	for _, d := range defs {
		total += d.Bits
	}
	return TypeBits{Definitions: defs, TotalBits: total}
}

func (t TypeBits) Parse(ctx *ParseContext) (interface{}, error) {
	byteCount := t.TotalBits / 8
	raw, err := ctx.Read(byteCount)
	if err != nil {
		return nil, err
	}
	// MSB-first 鍮꾪듃??援ъ꽦
	var value uint64
	for _, b := range raw {
		value = (value << 8) | uint64(b)
	}
	result := make(map[string]interface{})
	remainingBits := t.TotalBits
	for _, d := range t.Definitions {
		remainingBits -= d.Bits
		mask := uint64((1 << d.Bits) - 1)
		result[d.Name] = int((value >> uint(remainingBits)) & mask)
	}
	return result, nil
}

// ============================================================================
// Custom Types
// ============================================================================

type TypeCustom struct {
	ParseFn func(ctx *ParseContext) (interface{}, error)
}

func (t TypeCustom) Parse(ctx *ParseContext) (interface{}, error) {
	return t.ParseFn(ctx)
}

type TypeComputed struct {
	CalcFn func(ctx *ParseContext) interface{}
}

func (t TypeComputed) Parse(ctx *ParseContext) (interface{}, error) {
	return t.CalcFn(ctx), nil
}

type TypeValidate struct {
	InnerType FieldType
	Validator func(val interface{}) bool
}

func (t TypeValidate) Parse(ctx *ParseContext) (interface{}, error) {
	val, err := t.InnerType.Parse(ctx)
	if err != nil {
		return nil, err
	}
	if !t.Validator(val) {
		return nil, newParseError(ctx.Offset, "寃利??ㅽ뙣: %v", val)
	}
	return val, nil
}

type TypeTransform struct {
	InnerType   FieldType
	TransformFn func(val interface{}) interface{}
}

func (t TypeTransform) Parse(ctx *ParseContext) (interface{}, error) {
	val, err := t.InnerType.Parse(ctx)
	if err != nil {
		return nil, err
	}
	return t.TransformFn(val), nil
}

// ============================================================================
// Field
// ============================================================================

type Field struct {
	Name        string
	FieldType   FieldType
	TransformFn func(val interface{}) interface{}
	ValidateFn  func(val interface{}) bool
	Default     interface{}
	Hidden      bool
}

func NewField(name string, fieldType FieldType) *Field {
	return &Field{Name: name, FieldType: fieldType}
}

func (f *Field) WithTransform(fn func(interface{}) interface{}) *Field {
	f.TransformFn = fn
	return f
}

func (f *Field) WithValidate(fn func(interface{}) bool) *Field {
	f.ValidateFn = fn
	return f
}

func (f *Field) WithDefault(val interface{}) *Field {
	f.Default = val
	return f
}

func (f *Field) ParseInto(ctx *ParseContext) error {
	value, err := f.FieldType.Parse(ctx)
	if err != nil {
		if f.Default != nil {
			value = f.Default
		} else {
			return err
		}
	}

	// Padding? 寃곌낵????ν븯吏 ?딆쓬
	if _, ok := f.FieldType.(TypePadding); ok {
		return nil
	}

	// Optional 議곌굔 誘몄땐議???(nil 諛섑솚) 寃곌낵???ы븿?섏? ?딆쓬
	if _, ok := f.FieldType.(TypeOptional); ok && value == nil {
		return nil
	}

	if f.TransformFn != nil {
		value = f.TransformFn(value)
	}

	if f.ValidateFn != nil && !f.ValidateFn(value) {
		return newParseError(ctx.Offset, "?꾨뱶 '%s' 寃利??ㅽ뙣: %v", f.Name, value)
	}

	if f.Hidden {
		// hidden: 寃곌낵???ы븿?섏? ?딆?留??대? 李몄“?⑹쑝濡????
		ctx.Internal[f.Name] = value
	} else {
		ctx.Results[f.Name] = value
	}
	return nil
}

// ============================================================================
// Packet Parser
// ============================================================================

type PacketParser struct {
	Rules []*Field
}

func NewPacketParser(rules []*Field) *PacketParser {
	return &PacketParser{Rules: rules}
}

func (p *PacketParser) Parse(data []byte) (map[string]interface{}, error) {
	ctx := NewParseContext(data)
	return p.parseWithContext(ctx)
}

func (p *PacketParser) parseWithContext(ctx *ParseContext) (map[string]interface{}, error) {
	for _, f := range p.Rules {
		if err := f.ParseInto(ctx); err != nil {
			return nil, err
		}
	}
	return ctx.Results, nil
}
