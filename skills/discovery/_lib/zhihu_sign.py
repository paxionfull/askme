"""知乎 x-zse-96 签名（2025+ 算法，移植自 fxzhihu zhihu-sign.ts）。"""

from __future__ import annotations

import urllib.parse

ZSE_93 = "101_3_3.0"
ZSE_96_PREFIX = "2.0_"

SBOX = [
    20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91,
    237, 9, 125, 157, 230, 93, 252, 205, 90, 79, 144, 199, 159, 197, 186, 167,
    39, 37, 156, 198, 38, 42, 43, 168, 217, 153, 15, 103, 80, 189, 71, 191,
    97, 84, 247, 95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148, 86, 182,
    32, 83, 158, 109, 22, 255, 94, 238, 151, 85, 77, 124, 254, 18, 4, 26,
    123, 176, 232, 193, 131, 172, 143, 142, 150, 30, 10, 146, 162, 62, 224, 218,
    196, 229, 1, 192, 213, 27, 110, 56, 231, 180, 138, 107, 242, 187, 54, 120,
    19, 44, 117, 228, 215, 203, 53, 239, 251, 127, 81, 11, 133, 96, 204, 132,
    41, 115, 73, 55, 249, 147, 102, 48, 122, 145, 106, 118, 74, 190, 29, 16,
    174, 5, 177, 129, 63, 113, 99, 31, 161, 76, 246, 34, 211, 13, 60, 68,
    207, 160, 65, 111, 82, 165, 67, 169, 225, 57, 112, 244, 155, 51, 236, 200,
    233, 58, 61, 47, 100, 137, 185, 64, 17, 70, 234, 163, 219, 108, 170, 166,
    59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226, 119, 136, 206, 135,
    175, 195, 25, 92, 121, 208, 126, 139, 3, 75, 141, 21, 130, 98, 241, 40,
    154, 66, 184, 49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188, 104, 179,
    210, 134, 250, 201, 164, 89, 216, 202, 220, 50, 221, 152, 140, 33, 235, 214,
]

ROUND_KEYS = [key & 0xFFFFFFFF for key in [
    1170614578, 1024848638, 1413669199, -343334464, -766094290, -1373058082,
    -143119608, -297228157, 1933479194, -971186181, -406453910, 460404854,
    -547427574, -1891326262, -1679095901, 2119585428, -2029270069, 2035090028,
    -1521520070, -5587175, -77751101, -2094365853, -1243052806, 1579901135,
    1321810770, 456816404, -1391643889, -229302305, 330002838, -788960546,
    363569021, -1947871109,
]]

SHUFFLED_B64 = "6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE"
ENCRYPT_KEY = "059053f7d15e01d7"

_MD5_SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

_MD5_CONSTANTS = [
    0xD76AA478, 0xE8C7B756, 0x242070DB, 0xC1BDCEEE, 0xF57C0FAF, 0x4787C62A, 0xA8304613, 0xFD469501,
    0x698098D8, 0x8B44F7AF, 0xFFFF5BB1, 0x895CD7BE, 0x6B901122, 0xFD987193, 0xA679438E, 0x49B40821,
    0xF61E2562, 0xC040B340, 0x265E5A51, 0xE9B6C7AA, 0xD62F105D, 0x02441453, 0xD8A1E681, 0xE7D3FBC8,
    0x21E1CDE6, 0xC33707D6, 0xF4D50D87, 0x455A14ED, 0xA9E3E905, 0xFCEFA3F8, 0x676F02D9, 0x8D2A4C8A,
    0xFFFA3942, 0x8771F681, 0x6D9D6122, 0xFDE5380C, 0xA4BEEA44, 0x4BDECFA9, 0xF6BB4B60, 0xBEBFBC70,
    0x289B7EC6, 0xEAA127FA, 0xD4EF3085, 0x04881D05, 0xD9D4D039, 0xE6DB99E5, 0x1FA27CF8, 0xC4AC5665,
    0xF4292244, 0x432AFF97, 0xAB9423A7, 0xFC93A039, 0x655B59C3, 0x8F0CCC92, 0xFFEFF47D, 0x85845DD1,
    0x6FA87E4F, 0xFE2CE6E0, 0xA3014314, 0x4E0811A1, 0xF7537E82, 0xBD3AF235, 0x2AD7D2BB, 0xEB86D391,
]


def _add32(a: int, b: int) -> int:
    return (a + b) & 0xFFFFFFFF


def _rotate_left(value: int, shift: int) -> int:
    return ((value << shift) | (value >> (32 - shift))) & 0xFFFFFFFF


def _bytes_to_uint32(data: bytes | bytearray, offset: int) -> int:
    return (
        ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3])
        & 0xFFFFFFFF
    )


def _uint32_to_bytes(value: int, target: bytearray, offset: int) -> None:
    target[offset] = (value >> 24) & 0xFF
    target[offset + 1] = (value >> 16) & 0xFF
    target[offset + 2] = (value >> 8) & 0xFF
    target[offset + 3] = value & 0xFF


def _sm4_transform(value: int) -> int:
    substituted = (
        (SBOX[(value >> 24) & 0xFF] << 24)
        | (SBOX[(value >> 16) & 0xFF] << 16)
        | (SBOX[(value >> 8) & 0xFF] << 8)
        | SBOX[value & 0xFF]
    ) & 0xFFFFFFFF
    return (
        substituted
        ^ _rotate_left(substituted, 2)
        ^ _rotate_left(substituted, 10)
        ^ _rotate_left(substituted, 18)
        ^ _rotate_left(substituted, 24)
    ) & 0xFFFFFFFF


def _sm4_encrypt_block(block: bytes | bytearray) -> bytearray:
    state = [0] * 36
    state[0] = _bytes_to_uint32(block, 0)
    state[1] = _bytes_to_uint32(block, 4)
    state[2] = _bytes_to_uint32(block, 8)
    state[3] = _bytes_to_uint32(block, 12)
    for i in range(32):
        state[i + 4] = (
            state[i]
            ^ _sm4_transform(state[i + 1] ^ state[i + 2] ^ state[i + 3] ^ ROUND_KEYS[i])
        ) & 0xFFFFFFFF
    encrypted = bytearray(16)
    _uint32_to_bytes(state[35], encrypted, 0)
    _uint32_to_bytes(state[34], encrypted, 4)
    _uint32_to_bytes(state[33], encrypted, 8)
    _uint32_to_bytes(state[32], encrypted, 12)
    return encrypted


def _pkcs7_pad(data: bytes | bytearray, block_size: int = 16) -> bytearray:
    pad_length = block_size - (len(data) % block_size)
    padded = bytearray(len(data) + pad_length)
    padded[: len(data)] = data
    padded[len(data) :] = bytes([pad_length] * pad_length)
    return padded


def _sm4_cbc_encrypt(plaintext: bytes | bytearray, iv: bytes | bytearray) -> bytearray:
    encrypted = bytearray(len(plaintext))
    previous = bytearray(iv)
    for offset in range(0, len(plaintext), 16):
        block = bytearray(16)
        for i in range(16):
            block[i] = plaintext[offset + i] ^ previous[i]
        previous = _sm4_encrypt_block(block)
        encrypted[offset : offset + 16] = previous
    return encrypted


def _encode_uri_component_bytes(text: str) -> bytes:
    return urllib.parse.quote(text, safe="").encode("ascii")


def _shuffled_base64_encode(data: bytes | bytearray) -> str:
    remainder = len(data) % 3
    if remainder == 0:
        input_bytes = bytearray(data)
    else:
        input_bytes = bytearray(len(data) + 3 - remainder)
        input_bytes[: len(data)] = data

    result: list[str] = []
    mask_offset = 0
    offset = len(input_bytes) - 1
    while offset >= 0:
        value = 0
        for i in range(3):
            mask = (58 >> (8 * (mask_offset % 4))) & 0xFF
            value |= ((input_bytes[offset - i] ^ mask) & 0xFF) << (8 * i)
            mask_offset += 1
        result.append(SHUFFLED_B64[value & 0x3F])
        result.append(SHUFFLED_B64[(value >> 6) & 0x3F])
        result.append(SHUFFLED_B64[(value >> 12) & 0x3F])
        result.append(SHUFFLED_B64[(value >> 18) & 0x3F])
        offset -= 3
    return "".join(result)


def _zhihu_encrypt(md5_hex: str) -> str:
    encoded_input = _encode_uri_component_bytes(md5_hex)
    plaintext = bytearray(2 + len(encoded_input))
    plaintext[0] = 210
    plaintext[1] = 0
    plaintext[2:] = encoded_input

    padded = _pkcs7_pad(plaintext)
    key = ENCRYPT_KEY.encode("ascii")
    first_block = bytearray(padded[:16])
    for i in range(len(first_block)):
        first_block[i] ^= key[i] ^ 42

    first_cipher_block = _sm4_encrypt_block(first_block)
    cipher_text = bytearray(len(padded))
    cipher_text[:16] = first_cipher_block
    if len(padded) > 16:
        cipher_text[16:] = _sm4_cbc_encrypt(padded[16:], first_cipher_block)
    return _shuffled_base64_encode(cipher_text)


def _md5(text: str) -> str:
    input_bytes = text.encode("utf-8")
    with_padding = bytearray((((len(input_bytes) + 8) >> 6) + 1) * 64)
    with_padding[: len(input_bytes)] = input_bytes
    with_padding[len(input_bytes)] = 0x80

    bit_length_low = (len(input_bytes) * 8) & 0xFFFFFFFF
    bit_length_high = (len(input_bytes) * 8) // 0x100000000
    length_offset = len(with_padding) - 8
    for i in range(4):
        with_padding[length_offset + i] = (bit_length_low >> (8 * i)) & 0xFF
        with_padding[length_offset + 4 + i] = (bit_length_high >> (8 * i)) & 0xFF

    a0, b0, c0, d0 = 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476
    for offset in range(0, len(with_padding), 64):
        words = [0] * 16
        for i in range(16):
            words[i] = (
                with_padding[offset + i * 4]
                | (with_padding[offset + i * 4 + 1] << 8)
                | (with_padding[offset + i * 4 + 2] << 16)
                | (with_padding[offset + i * 4 + 3] << 24)
            ) & 0xFFFFFFFF

        a, b, c, d = a0, b0, c0, d0
        for i in range(64):
            if i < 16:
                f = (b & c) | ((~b) & d)
                g = i
            elif i < 32:
                f = (d & b) | ((~d) & c)
                g = (5 * i + 1) % 16
            elif i < 48:
                f = b ^ c ^ d
                g = (3 * i + 5) % 16
            else:
                f = c ^ (b | (~d & 0xFFFFFFFF))
                g = (7 * i) % 16

            next_d = d
            d = c
            c = b
            b = _add32(
                b,
                _rotate_left(
                    _add32(_add32(a, f & 0xFFFFFFFF), _add32(_MD5_CONSTANTS[i], words[g])),
                    _MD5_SHIFTS[i],
                ),
            )
            a = next_d

        a0 = _add32(a0, a)
        b0 = _add32(b0, b)
        c0 = _add32(c0, c)
        d0 = _add32(d0, d)

    digest = bytearray(16)
    for index, value in enumerate((a0, b0, c0, d0)):
        for i in range(4):
            digest[index * 4 + i] = (value >> (8 * i)) & 0xFF
    return digest.hex()


def normalize_cookie_value(value: str) -> str:
    normalized = value.strip()
    try:
        normalized = urllib.parse.unquote(normalized)
    except Exception:
        pass
    if normalized.startswith("%22") and normalized.endswith("%22"):
        normalized = normalized[3:-3]
    if normalized.startswith('"') and normalized.endswith('"'):
        normalized = normalized[1:-1]
    return normalized


def get_cookie_value(cookie: str, key: str) -> str:
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith(f"{key}="):
            return part[len(key) + 1 :]
    return ""


def get_signed_zhihu_headers(url: str, d_c0: str) -> dict[str, str]:
    parsed = urllib.parse.urlparse(url)
    source = "+".join([ZSE_93, parsed.path + (f"?{parsed.query}" if parsed.query else ""), normalize_cookie_value(d_c0)])
    return {
        "x-api-version": "3.0.91",
        "x-zse-93": ZSE_93,
        "x-zse-96": ZSE_96_PREFIX + _zhihu_encrypt(_md5(source)),
        "x-requested-with": "fetch",
        "x-app-za": "OS=Web",
    }
