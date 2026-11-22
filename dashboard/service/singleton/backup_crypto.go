package singleton

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"io"

	"golang.org/x/crypto/pbkdf2"
)

const (
	openSSLSaltHeader = "Salted__"
	openSSLPBKDF2Iter = 100000
)

// IsOpenSSLEncrypted checks whether payload starts with the standard OpenSSL "Salted__" header.
func IsOpenSSLEncrypted(data []byte) bool {
	return len(data) >= 32 && bytes.Equal(data[:8], []byte(openSSLSaltHeader))
}

// EncryptOpenSSLCompatible encrypts plaintext in the exact format compatible with:
//
//	openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -in backup.tar.gz.enc -out backup.tar.gz
//
// This guarantees the user can restore backups BOTH via the Admin UI AND on any bare Linux VPS using openssl.
func EncryptOpenSSLCompatible(plaintext []byte, passphrase string) ([]byte, error) {
	if passphrase == "" {
		return nil, errors.New("加密密码不能为空")
	}
	salt := make([]byte, 8)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}
	derived := pbkdf2.Key([]byte(passphrase), salt, openSSLPBKDF2Iter, 48, sha256.New)
	key := derived[:32]
	iv := derived[32:48]

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	padLen := aes.BlockSize - (len(plaintext) % aes.BlockSize)
	padded := make([]byte, len(plaintext)+padLen)
	copy(padded, plaintext)
	for i := len(plaintext); i < len(padded); i++ {
		padded[i] = byte(padLen)
	}

	ciphertext := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(ciphertext, padded)

	out := make([]byte, 0, 16+len(ciphertext))
	out = append(out, []byte(openSSLSaltHeader)...)
	out = append(out, salt...)
	out = append(out, ciphertext...)
	return out, nil
}

// DecryptOpenSSLCompatible decrypts payloads encrypted by EncryptOpenSSLCompatible or `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256`.
func DecryptOpenSSLCompatible(data []byte, passphrase string) ([]byte, error) {
	if passphrase == "" {
		return nil, errors.New("该备份包已加密，请输入备份密码后再导入")
	}
	if !IsOpenSSLEncrypted(data) {
		return nil, errors.New("无效的加密备份文件头")
	}
	salt := data[8:16]
	ciphertext := data[16:]
	if len(ciphertext) == 0 || len(ciphertext)%aes.BlockSize != 0 {
		return nil, errors.New("加密备份文件已损坏或不完整")
	}

	derived := pbkdf2.Key([]byte(passphrase), salt, openSSLPBKDF2Iter, 48, sha256.New)
	key := derived[:32]
	iv := derived[32:48]

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	plainPadded := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plainPadded, ciphertext)

	padLen := int(plainPadded[len(plainPadded)-1])
	if padLen <= 0 || padLen > aes.BlockSize || padLen > len(plainPadded) {
		return nil, errors.New("解密失败：备份密码错误或文件已损坏")
	}
	for i := len(plainPadded) - padLen; i < len(plainPadded); i++ {
		if int(plainPadded[i]) != padLen {
			return nil, errors.New("解密失败：备份密码错误或文件已损坏")
		}
	}
	return plainPadded[:len(plainPadded)-padLen], nil
}
