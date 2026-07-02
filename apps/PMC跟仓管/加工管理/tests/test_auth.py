from pcba.auth import hash_password, verify_password


def test_hash_is_not_plaintext():
    h = hash_password("secret")
    assert h != "secret"
    assert "$" in h  # 形如 algo$salt$hash


def test_verify_correct_password():
    h = hash_password("secret")
    assert verify_password("secret", h) is True


def test_verify_wrong_password():
    h = hash_password("secret")
    assert verify_password("wrong", h) is False


def test_two_hashes_differ_by_salt():
    assert hash_password("secret") != hash_password("secret")
