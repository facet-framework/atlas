package engine

import (
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
)

type value struct {
	raw any
	num *big.Rat
}

var decimal = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$`)
var variable = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func literal(s string) (value, error) {
	s = strings.TrimSpace(s)
	if s == "true" || s == "false" {
		return value{raw: s == "true"}, nil
	}
	if strings.HasPrefix(s, `"`) {
		var v string
		if json.Unmarshal([]byte(s), &v) == nil {
			return value{raw: v}, nil
		}
	}
	if len(s) <= 64 && decimal.MatchString(s) {
		n, ok := new(big.Rat).SetString(s)
		if ok {
			return value{raw: json.Number(s), num: n}, nil
		}
	}
	return value{}, fmt.Errorf("unsupported literal %q", s)
}
func number(n *big.Rat) value {
	d := new(big.Int).Set(n.Denom())
	two, five := big.NewInt(2), big.NewInt(5)
	a, b := 0, 0
	for new(big.Int).Mod(d, two).Sign() == 0 {
		d.Div(d, two)
		a++
	}
	for new(big.Int).Mod(d, five).Sign() == 0 {
		d.Div(d, five)
		b++
	}
	if b > a {
		a = b
	}
	return value{raw: json.Number(n.FloatString(a)), num: n}
}
func equal(a, b value) bool {
	if a.num != nil && b.num != nil {
		return a.num.Cmp(b.num) == 0
	}
	return a.num == nil && b.num == nil && a.raw == b.raw
}

type predicate struct {
	match  func(value) bool
	bounds []value
}

func split(s string) ([]string, error) {
	var out []string
	start := 0
	quoted := false
	escaped := false
	for i, r := range s {
		if escaped {
			escaped = false
			continue
		}
		if quoted && r == '\\' {
			escaped = true
			continue
		}
		if r == '"' {
			quoted = !quoted
		}
		if r == ',' && !quoted {
			out = append(out, strings.TrimSpace(s[start:i]))
			start = i + 1
		}
	}
	if quoted {
		return nil, fmt.Errorf("unterminated string")
	}
	return append(out, strings.TrimSpace(s[start:])), nil
}
func unary(s, typ string) (predicate, error) {
	s = strings.TrimSpace(s)
	if s == "-" {
		return predicate{match: func(v value) bool { return compatible(v, typ) }}, nil
	}
	parts, err := split(s)
	if err != nil {
		return predicate{}, err
	}
	if len(parts) > 1000 {
		return predicate{}, fmt.Errorf("at most 1000 alternatives per unary test")
	}
	var ps []predicate
	var bounds []value
	for _, p := range parts {
		q, e := atom(p, typ)
		if e != nil {
			return predicate{}, e
		}
		ps = append(ps, q)
		bounds = append(bounds, q.bounds...)
	}
	return predicate{bounds: bounds, match: func(v value) bool {
		for _, p := range ps {
			if p.match(v) {
				return true
			}
		}
		return false
	}}, nil
}
func compatible(v value, t string) bool {
	switch t {
	case "number":
		return v.num != nil
	case "string":
		_, ok := v.raw.(string)
		return ok
	case "boolean":
		_, ok := v.raw.(bool)
		return ok
	}
	return false
}
func atom(s, typ string) (predicate, error) {
	if len(s) > 2 && strings.Contains(s, "..") && (s[0] == '[' || s[0] == '(' || s[0] == ']') {
		a, b, ok := strings.Cut(s[1:len(s)-1], "..")
		if !ok {
			return predicate{}, fmt.Errorf("invalid interval")
		}
		lo, e := literal(a)
		if e != nil {
			return predicate{}, e
		}
		hi, e := literal(b)
		if e != nil {
			return predicate{}, e
		}
		end := s[len(s)-1]
		if typ != "number" || lo.num == nil || hi.num == nil || lo.num.Cmp(hi.num) > 0 || (end != ']' && end != ')' && end != '[') {
			return predicate{}, fmt.Errorf("invalid numeric interval %q", s)
		}
		return predicate{bounds: []value{lo, hi}, match: func(v value) bool {
			if v.num == nil {
				return false
			}
			l, h := v.num.Cmp(lo.num), v.num.Cmp(hi.num)
			return (l > 0 || l == 0 && s[0] == '[') && (h < 0 || h == 0 && end == ']')
		}}, nil
	}
	op := "="
	for _, prefix := range []string{"<=", ">=", "<", ">", "="} {
		if strings.HasPrefix(s, prefix) {
			op = prefix
			s = strings.TrimSpace(strings.TrimPrefix(s, prefix))
			break
		}
	}
	v, e := literal(s)
	if e != nil {
		return predicate{}, e
	}
	if !compatible(v, typ) {
		return predicate{}, fmt.Errorf("literal does not match type %s", typ)
	}
	if op != "=" && typ != "number" {
		return predicate{}, fmt.Errorf("only numeric comparisons are supported")
	}
	return predicate{bounds: []value{v}, match: func(x value) bool {
		if op == "=" {
			return equal(x, v)
		}
		if x.num == nil {
			return false
		}
		c := x.num.Cmp(v.num)
		switch op {
		case "<":
			return c < 0
		case "<=":
			return c <= 0
		case ">":
			return c > 0
		default:
			return c >= 0
		}
	}}, nil
}
func representatives(typ string, domain predicate, bounds []value) ([]value, error) {
	if len(bounds) > 10000 {
		return nil, fmt.Errorf("too many partition boundaries")
	}
	var vs []value
	switch typ {
	case "number":
		nums := []*big.Rat{}
		for _, v := range bounds {
			if v.num != nil {
				nums = append(nums, v.num)
			}
		}
		if len(nums) == 0 {
			nums = append(nums, big.NewRat(0, 1))
		}
		sort.Slice(nums, func(i, j int) bool { return nums[i].Cmp(nums[j]) < 0 })
		vs = append(vs, number(new(big.Rat).Sub(nums[0], big.NewRat(1, 1))))
		for i, n := range nums {
			vs = append(vs, number(n))
			if i+1 < len(nums) && n.Cmp(nums[i+1]) != 0 {
				vs = append(vs, number(new(big.Rat).Quo(new(big.Rat).Add(n, nums[i+1]), big.NewRat(2, 1))))
			}
		}
		vs = append(vs, number(new(big.Rat).Add(nums[len(nums)-1], big.NewRat(1, 1))))
	case "boolean":
		vs = []value{{raw: false}, {raw: true}}
	case "string":
		vs = domain.bounds
		if len(vs) == 0 {
			return nil, fmt.Errorf("string domain must enumerate its values")
		}
	default:
		return nil, fmt.Errorf("unsupported type %q", typ)
	}
	var out []value
	seen := map[string]bool{}
	for _, v := range vs {
		if !domain.match(v) {
			continue
		}
		key := fmt.Sprintf("%T:%v", v.raw, v.raw)
		if v.num != nil {
			key = "number:" + v.num.RatString()
		}
		if !seen[key] {
			seen[key] = true
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("empty input domain")
	}
	return out, nil
}
