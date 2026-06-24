package protocol

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// ApplyDecoration evaluates a template like "{v/10}.{v%10}" using integer v.
func ApplyDecoration(template string, v int64) (string, error) {
	if template == "" {
		return "", nil
	}
	var out strings.Builder
	i := 0
	for i < len(template) {
		if template[i] == '{' {
			end := strings.IndexByte(template[i:], '}')
			if end < 0 {
				return "", fmt.Errorf("unclosed expression in decoration")
			}
			expr := strings.TrimSpace(template[i+1 : i+end])
			n, err := evalDecorationExpr(expr, v)
			if err != nil {
				return "", fmt.Errorf("decoration expr %q: %w", expr, err)
			}
			out.WriteString(strconv.FormatInt(n, 10))
			i += end + 1
		} else {
			out.WriteByte(template[i])
			i++
		}
	}
	return out.String(), nil
}

func fieldValueToInt(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case uint64:
		return int64(n), true
	case int64:
		return n, true
	case int:
		return int64(n), true
	case float64:
		return int64(n), true
	default:
		return 0, false
	}
}

func applyFieldDecoration(result map[string]interface{}, name, decoration string, val interface{}) {
	if decoration == "" {
		return
	}
	iv, ok := fieldValueToInt(val)
	if !ok {
		return
	}
	dec, err := ApplyDecoration(decoration, iv)
	if err != nil {
		return
	}
	result[name+"_display"] = dec
}

type exprParser struct {
	src string
	pos int
	v   int64
}

func evalDecorationExpr(expr string, v int64) (int64, error) {
	p := &exprParser{src: strings.TrimSpace(expr), v: v}
	if p.src == "" {
		return 0, fmt.Errorf("empty expression")
	}
	n, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	p.skipSpace()
	if p.pos < len(p.src) {
		return 0, fmt.Errorf("unexpected trailing input at %q", p.src[p.pos:])
	}
	return n, nil
}

func (p *exprParser) parseExpr() (int64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.src) {
			break
		}
		op := p.src[p.pos]
		if op != '+' && op != '-' {
			break
		}
		p.pos++
		right, err := p.parseTerm()
		if err != nil {
			return 0, err
		}
		if op == '+' {
			left += right
		} else {
			left -= right
		}
	}
	return left, nil
}

func (p *exprParser) parseTerm() (int64, error) {
	left, err := p.parseFactor()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.src) {
			break
		}
		op := p.src[p.pos]
		if op != '*' && op != '/' && op != '%' {
			break
		}
		p.pos++
		right, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		switch op {
		case '*':
			left *= right
		case '/':
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			left /= right
		case '%':
			if right == 0 {
				return 0, fmt.Errorf("modulo by zero")
			}
			left %= right
		}
	}
	return left, nil
}

func (p *exprParser) parseFactor() (int64, error) {
	p.skipSpace()
	if p.pos >= len(p.src) {
		return 0, fmt.Errorf("unexpected end of expression")
	}
	switch p.src[p.pos] {
	case '(':
		p.pos++
		n, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		p.skipSpace()
		if p.pos >= len(p.src) || p.src[p.pos] != ')' {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		p.pos++
		return n, nil
	case 'v':
		p.pos++
		return p.v, nil
	default:
		start := p.pos
		if p.src[p.pos] == '-' {
			p.pos++
		}
		for p.pos < len(p.src) && unicode.IsDigit(rune(p.src[p.pos])) {
			p.pos++
		}
		if start == p.pos || (p.src[start] == '-' && p.pos == start+1) {
			return 0, fmt.Errorf("invalid token at %q", p.src[p.pos:])
		}
		n, err := strconv.ParseInt(p.src[start:p.pos], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid number %q", p.src[start:p.pos])
		}
		return n, nil
	}
}

func (p *exprParser) skipSpace() {
	for p.pos < len(p.src) && unicode.IsSpace(rune(p.src[p.pos])) {
		p.pos++
	}
}
