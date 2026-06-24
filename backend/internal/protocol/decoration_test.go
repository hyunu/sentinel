package protocol

import "testing"

func TestApplyDecoration(t *testing.T) {
	tests := []struct {
		template string
		v        int64
		want     string
	}{
		{"{v/10}.{v%10}", 235, "23.5"},
		{"{v/10}.{v%10}", 240, "24.0"},
		{"{v}", 42, "42"},
		{"{v/100}", 12345, "123"},
		{"{v%256}", 300, "44"},
		{"prefix{v}suffix", 7, "prefix7suffix"},
		{"{v/10}-{v%10}", 235, "23-5"},
	}
	for _, tt := range tests {
		got, err := ApplyDecoration(tt.template, tt.v)
		if err != nil {
			t.Fatalf("ApplyDecoration(%q, %d): %v", tt.template, tt.v, err)
		}
		if got != tt.want {
			t.Errorf("ApplyDecoration(%q, %d) = %q, want %q", tt.template, tt.v, got, tt.want)
		}
	}
}

func TestEvalDecorationExpr(t *testing.T) {
	got, err := evalDecorationExpr("(v+5)*2", 10)
	if err != nil {
		t.Fatal(err)
	}
	if got != 30 {
		t.Fatalf("got %d want 30", got)
	}
}
