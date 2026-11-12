# Token Contract v1.1

This document defines proposed v1.1 authentication-token changes. **Needs approval from all 3
members before freeze.**

## Issuance and verification

| Responsibility | Owner                       | Details                                                                                                                       |
| -------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Issuer         | Member 3's platform backend | Issues tokens after successful `POST /api/login`.                                                                             |
| Verifier       | `/realtime` only            | Verifies the token during WebSocket handshakes and admin HTTP requests. The real-time service never issues production tokens. |

Both services use the same secret from the `JWT_SECRET` environment variable. The secret must
remain private and must never be committed to the repository.

## Signing and claims

| Property          | v1.1 value                                                                       |
| ----------------- | -------------------------------------------------------------------------------- |
| Signing algorithm | `HS256`                                                                          |
| Secret source     | `JWT_SECRET` environment variable, shared by the platform and real-time services |
| Token lifetime    | 1 hour from issuance                                                             |

The JWT payload contains these claims. `role` is issued by the platform and defaults to `user`
when omitted. Only the verified claim determines the site role; roles supplied in client
messages are never trusted.

| Claim      | Type        | Meaning                                                                    |
| ---------- | ----------- | -------------------------------------------------------------------------- |
| `userId`   | String      | Stable identifier for the authenticated user.                              |
| `username` | String      | Display name used by the signaling service.                                |
| `role`     | String      | Optional site role: `user` or `admin`; absence means `user`.               |
| `iat`      | NumericDate | Issued-at time, in seconds since the Unix epoch.                           |
| `exp`      | NumericDate | Expiration time, in seconds since the Unix epoch; one hour after issuance. |

Example payload (illustrative values only):

```json
{
  "userId": "user-123",
  "username": "Alex",
  "role": "user",
  "iat": 1794281400,
  "exp": 1794285000
}
```

Admin example:

```json
{
  "userId": "admin-123",
  "username": "Project Admin",
  "role": "admin",
  "iat": 1794281400,
  "exp": 1794285000
}
```

## WebSocket authentication

The client sends the JWT in the WebSocket connection query string:
`ws://host/ws?token=<JWT>`. Use `wss://` when connecting to a deployed service over HTTPS.

Putting tokens in query strings has a known weakness: URLs can be recorded in server, proxy, or
diagnostic logs. This method is accepted for this project. Deployments should avoid logging the
token-bearing URL and must use TLS (`wss://`) outside local development.

The real-time server handles authentication failures as follows:

| Condition                                                               | Error code      | WebSocket close code | Handling                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token missing, malformed, signature invalid, or required claims invalid | `INVALID_TOKEN` | `4001`               | If the connection has been accepted, send the contract `error` message and close. If verification fails during the HTTP upgrade, reject the upgrade with an HTTP error because no WebSocket frame can be sent yet. |
| Token has expired                                                       | `TOKEN_EXPIRED` | `4002`               | If the connection has been accepted, send the contract `error` message and close. If expiration is detected during the HTTP upgrade, reject the upgrade with an HTTP error.                                        |

The `error` frame shape and the other protocol error codes are defined in
[websocket-contract.md](./websocket-contract.md).

## Development-only test token helper

`/realtime/scripts/make-test-token.js` is a local development helper. It accepts a username,
signs a one-hour HS256 JWT using `JWT_SECRET`, and prints the token to standard output. It does
not replace the platform login endpoint and must not be used to issue production credentials.
Set a private local `JWT_SECRET` before running it; never commit that secret or a generated
token.

The real-time server also provides development-only `POST /dev/token`, accepting
`{"username":"alice","role":"user"}` and returning `{"token":"<JWT>"}`. `role` may be `user` or
`admin` for local tests; an omitted role defaults to `user`. It uses the same signing algorithm,
secret, claims, and lifetime. This endpoint is a local stand-in for Member 3's
`POST /api/login` and is disabled when `NODE_ENV=production`.

The test-token helper accepts `--role admin` for admin test tokens, for example
`npm run make:test-token -- Alice --role admin`. Never use the development helper or endpoint
to issue production tokens.

This v1.1 proposal **needs approval from all 3 members before it is frozen**. The platform login
service must be updated to issue only authorized role claims; clients cannot elevate their role.
