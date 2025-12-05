/**
 * License authorization and token management
 *
 * Handles API key exchange with the license server to obtain
 * JWT access tokens and sandbox URLs.
 */

/**
 * Authorization response from license server
 */
export interface AuthorizationResponse {
  access_token: string;
  sandbox_url: string;
  preview_url: string;
}

/**
 * Authorize license key and get JWT token + URLs from license server
 */
export async function authorizeApiKey(apiKey: string): Promise<AuthorizationResponse> {
  try {
    const response = await fetch('https://sandbox.computesdk.com/__api/license/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key: apiKey,
        increment_usage: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`License authorization failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new Error('No access token received from license server');
    }

    if (!data.sandbox_url) {
      throw new Error('No sandbox_url received from license server');
    }

    if (!data.preview_url) {
      throw new Error('No preview_url received from license server');
    }

    return {
      access_token: data.access_token,
      sandbox_url: data.sandbox_url,
      preview_url: data.preview_url
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('License authorization failed')) {
      throw error; // Re-throw our formatted error
    }
    // Network or other errors
    throw new Error(`Failed to authorize API key (network error): ${error instanceof Error ? error.message : String(error)}`);
  }
}
