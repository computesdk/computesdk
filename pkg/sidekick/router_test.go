package sidekick_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/heysnelling/computesdk/pkg/sidekick"
	"github.com/stretchr/testify/assert"
)

func TestHealthCheckEndpoint(t *testing.T) {
	// Passing nil, as HealthCheckHandler doesn't use the DB.
	router := sidekick.NewRouter()

	req, _ := http.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code, "Expected status OK for /health")

	var healthResponse map[string]string
	err := json.Unmarshal(rr.Body.Bytes(), &healthResponse)
	assert.NoError(t, err, "Error unmarshalling health response")

	assert.Equal(t, "ok", healthResponse["status"], "Expected health status to be 'ok'")
}
