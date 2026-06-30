// Serial Parser - JSON Rule Engine (Go)
// JSON으로 파싱 규칙을 정의하고, 바이너리 데이터를 파싱하여 결과 반환.
package ruleparser

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// ============================================================================
// JSON Rule Schema
// ============================================================================

type JsonRuleSet struct {
	Fields []JsonFieldRule `json:"fields"`
}

// JsonRuleDocument is the on-wire JSON document (_meta + fields).
type JsonRuleDocument struct {
	Meta   map[string]interface{} `json:"_meta,omitempty"`
	Fields []JsonFieldRule        `json:"fields"`
}

type JsonFieldRule struct {
	Name          string                     `json:"name"`
	Type          string                     `json:"type"`
	Endian        string                     `json:"endian,omitempty"`
	Size          int                        `json:"size,omitempty"`
	Encoding      string                     `json:"encoding,omitempty"`
	LengthFrom    interface{}                `json:"length_from,omitempty"`
	CountFrom     interface{}                `json:"count_from,omitempty"`
	Delimiter     []int                      `json:"delimiter,omitempty"`
	LenType       *JsonFieldRule             `json:"len_type,omitempty"`
	ItemType      *JsonFieldRule             `json:"item_type,omitempty"`
	ItemRules     []JsonFieldRule            `json:"item_rules,omitempty"`
	KeyFrom       string                     `json:"key_from,omitempty"`
	Cases         map[string][]JsonFieldRule `json:"cases,omitempty"`
	Default       []JsonFieldRule            `json:"default,omitempty"`
	Predicate     *ExprDef                   `json:"predicate,omitempty"`
	Then          []JsonFieldRule            `json:"then,omitempty"`
	Else          []JsonFieldRule            `json:"else,omitempty"`
	Rules         []JsonFieldRule            `json:"rules,omitempty"`
	FieldsDef     []JsonFieldRule            `json:"fields,omitempty"`
	BitsDef       []BitDef                   `json:"bits,omitempty"`
	Expr          string                     `json:"expr,omitempty"`
	TransformExpr string                     `json:"transform_expr,omitempty"`
	ValidateExpr  string                     `json:"validate_expr,omitempty"`
	Inner         *JsonFieldRule             `json:"inner,omitempty"`
}

type ExprDef struct {
	Expr string `json:"expr"`
}

type BitDef struct {
	Name string `json:"name"`
	Bits int    `json:"bits"`
}

// ============================================================================
// Expression Evaluator (간단한 수식 평가)
// ============================================================================
// Expression Evaluator (재귀 하강 파서)
// 지원: 괄호, 산술(+,-,*,/,%), 비교(==,!=,<,>,<=,>=),
//       비트(&,|,^,<<,>>), 논리(&&,||,!), 단항(-,!,~),
//       삼항(a ? b : c), 중첩 필드 접근(flags.has_seq)
// ============================================================================

type exprEvaluator struct {
	src  string
	pos  int
	vars map[string]interface{}
}

func evalSimpleExpr(exprStr string, vars map[string]interface{}) (interface{}, error) {
	e := &exprEvaluator{src: strings.TrimSpace(exprStr), pos: 0, vars: vars}
	result, err := e.parseTernary()
	if err != nil {
		return nil, fmt.Errorf("표현식 실행 실패: '%s': %v", exprStr, err)
	}
	return result, nil
}

func (e *exprEvaluator) peek() byte {
	e.skipSpace()
	if e.pos >= len(e.src) {
		return 0
	}
	return e.src[e.pos]
}

func (e *exprEvaluator) skipSpace() {
	for e.pos < len(e.src) && (e.src[e.pos] == ' ' || e.src[e.pos] == '\t') {
		e.pos++
	}
}

func (e *exprEvaluator) match(s string) bool {
	e.skipSpace()
	if e.pos+len(s) <= len(e.src) && e.src[e.pos:e.pos+len(s)] == s {
		// 연산자 뒤에 같은 문자가 오는지 체크 (예: == vs =)
		if len(s) == 1 && e.pos+2 <= len(e.src) {
			next := e.src[e.pos+1]
			switch s {
			case "=":
				if next == '=' {
					return false
				}
			case "!":
				if next == '=' {
					return false
				}
			case "<":
				if next == '=' || next == '<' {
					return false
				}
			case ">":
				if next == '=' || next == '>' {
					return false
				}
			case "&":
				if next == '&' {
					return false
				}
			case "|":
				if next == '|' {
					return false
				}
			}
		}
		e.pos += len(s)
		return true
	}
	return false
}

// 삼항 연산: expr ? expr : expr
func (e *exprEvaluator) parseTernary() (interface{}, error) {
	cond, err := e.parseOr()
	if err != nil {
		return nil, err
	}
	if e.match("?") {
		thenVal, err := e.parseTernary()
		if err != nil {
			return nil, err
		}
		if !e.match(":") {
			return nil, fmt.Errorf("삼항 연산에 ':' 필요")
		}
		elseVal, err := e.parseTernary()
		if err != nil {
			return nil, err
		}
		if toBool(cond) {
			return thenVal, nil
		}
		return elseVal, nil
	}
	return cond, nil
}

// 논리 OR: ||
func (e *exprEvaluator) parseOr() (interface{}, error) {
	left, err := e.parseAnd()
	if err != nil {
		return nil, err
	}
	for e.match("||") {
		right, err := e.parseAnd()
		if err != nil {
			return nil, err
		}
		left = toBool(left) || toBool(right)
	}
	return left, nil
}

// 논리 AND: &&
func (e *exprEvaluator) parseAnd() (interface{}, error) {
	left, err := e.parseBitOr()
	if err != nil {
		return nil, err
	}
	for e.match("&&") {
		right, err := e.parseBitOr()
		if err != nil {
			return nil, err
		}
		left = toBool(left) && toBool(right)
	}
	return left, nil
}

// 비트 OR: |
func (e *exprEvaluator) parseBitOr() (interface{}, error) {
	left, err := e.parseBitXor()
	if err != nil {
		return nil, err
	}
	for e.match("|") {
		right, err := e.parseBitXor()
		if err != nil {
			return nil, err
		}
		l, _ := toIntSafe(left)
		r, _ := toIntSafe(right)
		left = l | r
	}
	return left, nil
}

// 비트 XOR: ^
func (e *exprEvaluator) parseBitXor() (interface{}, error) {
	left, err := e.parseBitAnd()
	if err != nil {
		return nil, err
	}
	for e.match("^") {
		right, err := e.parseBitAnd()
		if err != nil {
			return nil, err
		}
		l, _ := toIntSafe(left)
		r, _ := toIntSafe(right)
		left = l ^ r
	}
	return left, nil
}

// 비트 AND: &
func (e *exprEvaluator) parseBitAnd() (interface{}, error) {
	left, err := e.parseEquality()
	if err != nil {
		return nil, err
	}
	for e.match("&") {
		right, err := e.parseEquality()
		if err != nil {
			return nil, err
		}
		l, _ := toIntSafe(left)
		r, _ := toIntSafe(right)
		left = l & r
	}
	return left, nil
}

// 동등 비교: ==, !=
func (e *exprEvaluator) parseEquality() (interface{}, error) {
	left, err := e.parseComparison()
	if err != nil {
		return nil, err
	}
	for {
		if e.match("==") {
			right, err := e.parseComparison()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l == r
		} else if e.match("!=") {
			right, err := e.parseComparison()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l != r
		} else {
			break
		}
	}
	return left, nil
}

// 비교: <, >, <=, >=
func (e *exprEvaluator) parseComparison() (interface{}, error) {
	left, err := e.parseShift()
	if err != nil {
		return nil, err
	}
	for {
		if e.match("<=") {
			right, err := e.parseShift()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l <= r
		} else if e.match(">=") {
			right, err := e.parseShift()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l >= r
		} else if e.match("<") {
			right, err := e.parseShift()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l < r
		} else if e.match(">") {
			right, err := e.parseShift()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l > r
		} else {
			break
		}
	}
	return left, nil
}

// 시프트: <<, >>
func (e *exprEvaluator) parseShift() (interface{}, error) {
	left, err := e.parseAddSub()
	if err != nil {
		return nil, err
	}
	for {
		if e.match("<<") {
			right, err := e.parseAddSub()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l << uint(r)
		} else if e.match(">>") {
			right, err := e.parseAddSub()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l >> uint(r)
		} else {
			break
		}
	}
	return left, nil
}

// 덧셈/뺄셈: +, -
func (e *exprEvaluator) parseAddSub() (interface{}, error) {
	left, err := e.parseMulDiv()
	if err != nil {
		return nil, err
	}
	for {
		if e.match("+") {
			right, err := e.parseMulDiv()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l + r
		} else if e.match("-") {
			right, err := e.parseMulDiv()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l - r
		} else {
			break
		}
	}
	return left, nil
}

// 곱셈/나눗셈/나머지: *, /, %
func (e *exprEvaluator) parseMulDiv() (interface{}, error) {
	left, err := e.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		if e.match("*") {
			right, err := e.parseUnary()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			left = l * r
		} else if e.match("/") {
			right, err := e.parseUnary()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			if r == 0 {
				left = 0
			} else {
				left = l / r
			}
		} else if e.match("%") {
			right, err := e.parseUnary()
			if err != nil {
				return nil, err
			}
			l, _ := toIntSafe(left)
			r, _ := toIntSafe(right)
			if r == 0 {
				left = 0
			} else {
				left = l % r
			}
		} else {
			break
		}
	}
	return left, nil
}

// 단항: -, !, ~
func (e *exprEvaluator) parseUnary() (interface{}, error) {
	if e.match("!") {
		val, err := e.parseUnary()
		if err != nil {
			return nil, err
		}
		return !toBool(val), nil
	}
	if e.match("~") {
		val, err := e.parseUnary()
		if err != nil {
			return nil, err
		}
		n, _ := toIntSafe(val)
		return ^n, nil
	}
	// 단항 마이너스: peek해서 숫자/변수/괄호 앞의 -인지 확인
	e.skipSpace()
	if e.pos < len(e.src) && e.src[e.pos] == '-' {
		// 다음이 숫자나 변수나 괄호면 단항 마이너스
		e.pos++
		val, err := e.parseUnary()
		if err != nil {
			return nil, err
		}
		n, _ := toIntSafe(val)
		return -n, nil
	}
	return e.parsePrimary()
}

// 기본값: 숫자, 변수, 괄호, 중첩 필드 접근
func (e *exprEvaluator) parsePrimary() (interface{}, error) {
	e.skipSpace()
	if e.pos >= len(e.src) {
		return nil, fmt.Errorf("예기치 않은 끝")
	}

	ch := e.src[e.pos]

	// 괄호
	if ch == '(' {
		e.pos++
		val, err := e.parseTernary()
		if err != nil {
			return nil, err
		}
		e.skipSpace()
		if e.pos < len(e.src) && e.src[e.pos] == ')' {
			e.pos++
		}
		return val, nil
	}

	// 숫자 리터럴 (0x 포함)
	if ch >= '0' && ch <= '9' {
		start := e.pos
		if ch == '0' && e.pos+1 < len(e.src) && (e.src[e.pos+1] == 'x' || e.src[e.pos+1] == 'X') {
			e.pos += 2
			for e.pos < len(e.src) && isHexDigit(e.src[e.pos]) {
				e.pos++
			}
		} else {
			for e.pos < len(e.src) && e.src[e.pos] >= '0' && e.src[e.pos] <= '9' {
				e.pos++
			}
		}
		n, err := strconv.ParseInt(e.src[start:e.pos], 0, 64)
		if err != nil {
			return nil, err
		}
		return int(n), nil
	}

	// true / false
	if strings.HasPrefix(e.src[e.pos:], "true") && (e.pos+4 >= len(e.src) || !isIdentChar(e.src[e.pos+4])) {
		e.pos += 4
		return true, nil
	}
	if strings.HasPrefix(e.src[e.pos:], "false") && (e.pos+5 >= len(e.src) || !isIdentChar(e.src[e.pos+5])) {
		e.pos += 5
		return false, nil
	}

	// 변수 (식별자), 중첩 접근 (a.b.c)
	if isIdentStart(ch) {
		start := e.pos
		for e.pos < len(e.src) && isIdentChar(e.src[e.pos]) {
			e.pos++
		}
		name := e.src[start:e.pos]
		val, ok := e.vars[name]
		if !ok {
			return nil, fmt.Errorf("변수 없음: '%s'", name)
		}
		// 중첩 접근: flags.has_seq
		for e.pos < len(e.src) && e.src[e.pos] == '.' {
			e.pos++ // skip '.'
			start = e.pos
			for e.pos < len(e.src) && isIdentChar(e.src[e.pos]) {
				e.pos++
			}
			field := e.src[start:e.pos]
			if m, ok := val.(map[string]interface{}); ok {
				val = m[field]
			} else {
				return nil, fmt.Errorf("'%s'에서 '%s' 접근 불가", name, field)
			}
		}
		return val, nil
	}

	return nil, fmt.Errorf("파싱 불가: '%s'", e.src[e.pos:])
}

func isHexDigit(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func isIdentStart(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'
}

func isIdentChar(c byte) bool {
	return isIdentStart(c) || (c >= '0' && c <= '9')
}

func toBool(val interface{}) bool {
	switch v := val.(type) {
	case bool:
		return v
	case int:
		return v != 0
	case int64:
		return v != 0
	default:
		return val != nil
	}
}

func toIntSafe(val interface{}) (int, bool) {
	n, err := toInt(val)
	if err != nil {
		// bool → int
		if b, ok := val.(bool); ok {
			if b {
				return 1, true
			}
			return 0, true
		}
		return 0, false
	}
	return n, true
}

// ============================================================================
// Length Resolver from JSON
// ============================================================================

func resolveLengthFromJSON(ref interface{}) LengthRef {
	switch v := ref.(type) {
	case string:
		return FromField(v)
	case map[string]interface{}:
		if exprStr, ok := v["expr"].(string); ok {
			return FromFunc(func(ctx *ParseContext) int {
				result, err := evalSimpleExpr(exprStr, ctx.ExprVars())
				if err != nil {
					return 0
				}
				n, _ := toInt(result)
				return n
			})
		}
	}
	return FromField(fmt.Sprintf("%v", ref))
}

// ============================================================================
// JSON → FieldType 변환
// ============================================================================

func BuildFieldType(rule JsonFieldRule) FieldType {
	endian := LittleEndian
	if rule.Endian == "big" {
		endian = BigEndian
	}

	switch rule.Type {
	// --- Primitive ---
	case "U8":
		return TypeU8{}
	case "U16":
		return TypeU16{Endian: endian}
	case "U32":
		return TypeU32{Endian: endian}
	case "I8":
		return TypeI8{}
	case "I16":
		return TypeI16{Endian: endian}
	case "I32":
		return TypeI32{Endian: endian}
	case "Float":
		return TypeFloat{Endian: endian}
	case "Bool":
		return TypeBool{}

	// --- Fixed ---
	case "Fixed":
		return TypeFixed{Size: rule.Size}
	case "String":
		return TypeString{Size: rule.Size}
	case "Padding":
		return TypePadding{Size: rule.Size}

	// --- Variable ---
	case "VarBytes":
		return TypeVarBytes{LengthFrom: resolveLengthFromJSON(rule.LengthFrom)}
	case "VarString":
		return TypeVarString{LengthFrom: resolveLengthFromJSON(rule.LengthFrom)}
	case "Until":
		delim := make([]byte, len(rule.Delimiter))
		for i, v := range rule.Delimiter {
			delim[i] = byte(v)
		}
		return TypeUntil{Delimiter: delim}
	case "UntilEnd":
		return TypeUntilEnd{}
	case "LengthPrefixed":
		return TypeLengthPrefixed{LenType: BuildFieldType(*rule.LenType)}

	// --- Repeat ---
	case "Array":
		return TypeArray{
			ItemType:  BuildFieldType(*rule.ItemType),
			CountFrom: resolveLengthFromJSON(rule.CountFrom),
		}
	case "RepeatCount":
		return TypeRepeatCount{
			ItemRules: BuildFields(rule.ItemRules),
			CountFrom: resolveLengthFromJSON(rule.CountFrom),
		}
	case "RepeatUntilEnd":
		return TypeRepeatUntilEnd{
			ItemRules: BuildFields(rule.ItemRules),
		}
	case "RepeatUntil":
		exprStr := ""
		if rule.Predicate != nil {
			exprStr = rule.Predicate.Expr
		}
		return TypeRepeatUntil{
			ItemRules: BuildFields(rule.ItemRules),
			Predicate: func(ctx *ParseContext, item map[string]interface{}) bool {
				merged := make(map[string]interface{})
				for k, v := range ctx.Results {
					merged[k] = v
				}
				for k, v := range item {
					merged[k] = v
				}
				result, err := evalSimpleExpr(exprStr, merged)
				if err != nil {
					return false
				}
				switch r := result.(type) {
				case bool:
					return r
				case int:
					return r != 0
				}
				return false
			},
		}

	// --- Conditional ---
	case "Switch":
		cases := make(map[interface{}][]*Field)
		for key, fieldRules := range rule.Cases {
			var k interface{}
			if n, err := strconv.Atoi(key); err == nil {
				k = n
			} else {
				k = key
			}
			fields := BuildFields(fieldRules)
			cases[k] = fields
		}
		var defaultFields []*Field
		if len(rule.Default) > 0 {
			defaultFields = BuildFields(rule.Default)
		}
		return TypeSwitch{
			KeyFrom: rule.KeyFrom,
			Cases:   cases,
			Default: defaultFields,
		}
	case "If":
		exprStr := ""
		if rule.Predicate != nil {
			exprStr = rule.Predicate.Expr
		}
		return TypeIf{
			Predicate: func(ctx *ParseContext) bool {
				result, _ := evalSimpleExpr(exprStr, ctx.ExprVars())
				switch r := result.(type) {
				case bool:
					return r
				case int:
					return r != 0
				}
				return false
			},
			ThenRules: BuildFields(rule.Then),
			ElseRules: BuildFields(rule.Else),
		}
	case "Optional":
		exprStr := ""
		if rule.Predicate != nil {
			exprStr = rule.Predicate.Expr
		}
		return TypeOptional{
			Rules: BuildFields(rule.Rules),
			Predicate: func(ctx *ParseContext) bool {
				result, _ := evalSimpleExpr(exprStr, ctx.ExprVars())
				switch r := result.(type) {
				case bool:
					return r
				case int:
					return r != 0
				}
				return false
			},
		}

	// --- Nested ---
	case "Struct":
		return TypeStruct{Fields: BuildFields(rule.FieldsDef)}
	case "Nested":
		return TypeNested{Parser: NewPacketParser(BuildFields(rule.FieldsDef))}

	// --- Bits ---
	case "Bits":
		defs := make([]BitFieldDef, len(rule.BitsDef))
		for i, b := range rule.BitsDef {
			defs[i] = BitFieldDef{Name: b.Name, Bits: b.Bits}
		}
		return NewTypeBits(defs)

	// --- Custom ---
	case "Computed":
		exprStr := rule.Expr
		return TypeComputed{
			CalcFn: func(ctx *ParseContext) interface{} {
				result, _ := evalSimpleExpr(exprStr, ctx.ExprVars())
				return result
			},
		}
	case "Transform":
		inner := BuildFieldType(*rule.Inner)
		transformExpr := rule.TransformExpr
		return TypeTransform{
			InnerType: inner,
			TransformFn: func(val interface{}) interface{} {
				vars := map[string]interface{}{"value": val}
				result, err := evalSimpleExpr(transformExpr, vars)
				if err != nil {
					return val
				}
				return result
			},
		}
	case "Validate":
		inner := BuildFieldType(*rule.Inner)
		validateExpr := rule.ValidateExpr
		return TypeValidate{
			InnerType: inner,
			Validator: func(val interface{}) bool {
				vars := map[string]interface{}{"value": val}
				result, err := evalSimpleExpr(validateExpr, vars)
				if err != nil {
					return false
				}
				switch r := result.(type) {
				case bool:
					return r
				case int:
					return r != 0
				}
				return false
			},
		}
	}

	return TypeCustom{ParseFn: func(ctx *ParseContext) (interface{}, error) {
		return nil, fmt.Errorf("알 수 없는 타입: '%s'", rule.Type)
	}}
}

func BuildFields(rules []JsonFieldRule) []*Field {
	fields := make([]*Field, len(rules))
	for i, r := range rules {
		fields[i] = NewField(r.Name, BuildFieldType(r))
	}
	return fields
}

// ============================================================================
// Public API
// ============================================================================

// ParseFromJSONDocument parses with a full rule document (optional _meta + fields).
func ParseFromJSONDocument(doc JsonRuleDocument, data []byte) (map[string]interface{}, error) {
	fields := BuildFields(doc.Fields)
	parser := NewPacketParser(fields)
	return parser.Parse(data)
}

// ParseFromJSON: JSON 규칙 문자열과 바이트 데이터를 받아 파싱 결과를 반환.
func ParseFromJSON(rulesJSON string, data []byte) (map[string]interface{}, error) {
	var doc JsonRuleDocument
	if err := json.Unmarshal([]byte(rulesJSON), &doc); err != nil {
		return nil, fmt.Errorf("JSON 규칙 파싱 실패: %v", err)
	}
	if len(doc.Fields) == 0 {
		var ruleSet JsonRuleSet
		if err := json.Unmarshal([]byte(rulesJSON), &ruleSet); err != nil {
			return nil, fmt.Errorf("JSON 규칙 파싱 실패: %v", err)
		}
		return ParseFromJSONObject(ruleSet, data)
	}
	return ParseFromJSONDocument(doc, data)
}

// ParseFromJSONObject: JSON 규칙 객체와 바이트 데이터를 받아 파싱 결과를 반환.
func ParseFromJSONObject(ruleSet JsonRuleSet, data []byte) (map[string]interface{}, error) {
	fields := BuildFields(ruleSet.Fields)
	parser := NewPacketParser(fields)
	return parser.Parse(data)
}

// CreateParserFromJSON: JSON 규칙으로부터 재사용 가능한 파서를 생성.
func CreateParserFromJSON(rulesJSON string) (*PacketParser, error) {
	var ruleSet JsonRuleSet
	if err := json.Unmarshal([]byte(rulesJSON), &ruleSet); err != nil {
		return nil, fmt.Errorf("JSON 규칙 파싱 실패: %v", err)
	}
	fields := BuildFields(ruleSet.Fields)
	return NewPacketParser(fields), nil
}
