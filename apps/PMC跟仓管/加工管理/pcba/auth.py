import hashlib
import hmac
import os

_ITER = 200_000
_ALGO = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITER)
    return f"{_ALGO}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, hash_hex = stored.split("$")
    except ValueError:
        return False
    if algo != _ALGO:
        return False
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITER)
    return hmac.compare_digest(dk.hex(), hash_hex)
