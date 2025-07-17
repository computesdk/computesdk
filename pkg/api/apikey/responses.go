package apikey

import "time"

// APIKeyResponse represents an API key in API responses
type APIKeyResponse struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	KeyPrefix   string            `json:"key_prefix"`
	Permissions []string          `json:"permissions"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	Status      string            `json:"status"`
	CreatedAt   time.Time         `json:"created_at"`
	LastUsedAt  *time.Time        `json:"last_used_at,omitempty"`
	RevokedAt   *time.Time        `json:"revoked_at,omitempty"`
	FullKey     string            `json:"full_key,omitempty"` // Only returned on creation
}

// APIKeyListResponse represents the response for listing API keys
type APIKeyListResponse struct {
	APIKeys []APIKeyResponse `json:"api_keys"`
	Total   int              `json:"total"`
}

// Helper functions to convert from summary types to API response types

func summaryToResponse(summary *APIKeySummary) *APIKeyResponse {
	if summary == nil {
		return nil
	}

	return &APIKeyResponse{
		ID:          summary.ID,
		Name:        summary.Name,
		KeyPrefix:   summary.KeyPrefix,
		Permissions: summary.Permissions,
		Metadata:    summary.Metadata,
		Status:      summary.Status,
		CreatedAt:   summary.CreatedAt,
		LastUsedAt:  summary.LastUsedAt,
		RevokedAt:   summary.RevokedAt,
		FullKey:     summary.FullKey,
	}
}

func summaryListToResponse(summaries []APIKeySummary) *APIKeyListResponse {
	response := &APIKeyListResponse{
		APIKeys: make([]APIKeyResponse, 0, len(summaries)),
		Total:   len(summaries),
	}

	for _, summary := range summaries {
		if converted := summaryToResponse(&summary); converted != nil {
			response.APIKeys = append(response.APIKeys, *converted)
		}
	}

	return response
}
