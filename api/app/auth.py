import hmac
import os
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)


def auth_disabled() -> bool:
    # Local development and tests only, never set on itdone.cloud
    return os.environ.get("AUTH_DISABLED") == "1"


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    issuer = os.environ["OIDC_ISSUER"].rstrip("/")
    return jwt.PyJWKClient(f"{issuer}/protocol/openid-connect/certs")


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    if auth_disabled():
        return "local"
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    if not os.environ.get("OIDC_ISSUER"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Login is not configured")
    token = credentials.credentials
    try:
        key = _jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=os.environ["OIDC_ISSUER"].rstrip("/"),
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {error}") from error
    # Keycloak SPA tokens carry the client in azp, not aud
    if claims.get("azp") != os.environ.get("OIDC_CLIENT_ID"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token was issued for another client")
    return claims.get("preferred_username") or claims.get("sub", "unknown")


def symbols_uploader(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    # Build machines upload dSYMs with a dedicated key that is valid for this one endpoint only
    upload_token = os.environ.get("SYMBOLS_UPLOAD_TOKEN", "")
    if upload_token and credentials and hmac.compare_digest(credentials.credentials.encode(), upload_token.encode()):
        return "build-upload"
    return current_user(credentials)
