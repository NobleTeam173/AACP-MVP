# CLAUDE Integration and MFA Notes

## MFA requirements
- Admin and coach accounts are treated as higher-risk roles and require multi-factor authentication by default.
- The backend supports explicit MFA lifecycle endpoints under `/auth/mfa`.

### MFA endpoints
- `POST /auth/mfa/setup`
  - Initiates MFA setup for a user.
  - Request body: `{ email, password }`
  - Response: `{ secret, message }`
- `POST /auth/mfa/confirm`
  - Confirms the MFA token and enables MFA for the account.
  - Request body: `{ email, password, token }`
  - Response: `{ success: true, message }`
- `POST /auth/mfa/disable`
  - Disables MFA for the account.
  - Request body: `{ email, password, otp? }`
  - Response: `{ success: true, message }`

## Test mode configuration
- To support integration testing without requiring live MFA tokens, the backend can bypass MFA enforcement using the environment flag:
  - `AACP_AUTH_TEST_MODE=true`
- When this flag is enabled:
  - Admin and coach users may log in with email/password alone.
  - MFA setup and token enforcement are skipped for login.

## Audit log endpoint
- Admin-only audit retrieval is exposed at `/audit/logs`.
- This route is protected by RBAC and requires a valid admin access token.
- Query parameters supported:
  - `userId`
  - `action`
  - `entityType`

## Notes
- Use `AACP_AUTH_TEST_MODE=true` only in test or development environments.
- Production deployments should keep MFA enforcement enabled for admin and coach accounts.
