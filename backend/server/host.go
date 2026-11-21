package server

import (
	"net"
	"net/http"
	"strings"
)

// localHost reports whether the Host header names this machine. Atlas binds
// to loopback, but a foreign name that resolves to 127.0.0.1 (DNS rebinding)
// would still reach it with its own Host; that request is refused.
func localHost(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// localHostOnly refuses every request whose Host header does not name this
// machine, before any route sees it.
func localHostOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !localHost(r.Host) {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			http.Error(w, "only a local host name may reach this reader", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
