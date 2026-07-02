package api

import "testing"

func TestNormalizeVizPointLimit(t *testing.T) {
	t.Parallel()

	cases := []struct {
		limit int
		want  int
	}{
		{limit: 0, want: vizDefaultPointLimit},
		{limit: -1, want: vizDefaultPointLimit},
		{limit: 500, want: 500},
		{limit: 8000, want: 8000},
		{limit: 20000, want: vizMaxPointLimit},
	}

	for _, tc := range cases {
		got := normalizeVizPointLimit(tc.limit)
		if got != tc.want {
			t.Fatalf("normalizeVizPointLimit(%d) = %d, want %d", tc.limit, got, tc.want)
		}
	}
}
