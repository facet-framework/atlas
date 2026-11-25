package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const signingKeyEnv = "ATLAS_RELEASE_SIGNING_KEY"
const signatureAlgorithm = "ed25519"

type publicSigningKey struct {
	KeyID     string `json:"key_id"`
	PublicKey string `json:"public_key"`
}

type manifestSignature struct {
	KeyID     string `json:"key_id"`
	Algorithm string `json:"algorithm"`
	Signature string `json:"signature"`
}

func signingKeyID(publicKey ed25519.PublicKey) string {
	sum := sha256.Sum256(publicKey)
	return fmt.Sprintf("%x", sum[:8])
}

func generateSigningKey(path string, out io.Writer) error {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(file, base64.StdEncoding.EncodeToString(privateKey.Seed()))
	if err := errors.Join(err, file.Close()); err != nil {
		return errors.Join(err, os.Remove(path))
	}
	return json.NewEncoder(out).Encode(publicSigningKey{
		KeyID:     signingKeyID(publicKey),
		PublicKey: base64.StdEncoding.EncodeToString(publicKey),
	})
}

func decodeSigningValue(value string, size int) ([]byte, bool) {
	data, err := base64.StdEncoding.DecodeString(value)
	return data, err == nil && len(data) == size && base64.StdEncoding.EncodeToString(data) == value
}

func readSigningSeed(source string) ([]byte, error) {
	var encoded string
	if source == "-" {
		encoded = os.Getenv(signingKeyEnv)
		if encoded == "" {
			return nil, fmt.Errorf("%s is required", signingKeyEnv)
		}
	} else {
		data, err := os.ReadFile(source)
		if err != nil {
			return nil, err
		}
		encoded = string(data)
	}
	seed, valid := decodeSigningValue(strings.TrimSuffix(strings.TrimSuffix(encoded, "\n"), "\r"), ed25519.SeedSize)
	if !valid {
		return nil, errors.New("signing key must be a single line containing a base64 Ed25519 seed")
	}
	return seed, nil
}

// @facet: workspace/contracts/signed-release-manifest
// @facet-role: primary
func signManifest(path, keySource string) error {
	seed, err := readSigningSeed(keySource)
	if err != nil {
		return err
	}
	manifest, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	privateKey := ed25519.NewKeyFromSeed(seed)
	signature, err := json.Marshal(manifestSignature{
		KeyID:     signingKeyID(privateKey.Public().(ed25519.PublicKey)),
		Algorithm: signatureAlgorithm,
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, manifest)),
	})
	if err != nil {
		return err
	}
	return os.WriteFile(path+".sig", append(signature, '\n'), 0644)
}

func verifyManifest(path, signaturePath, keysPath string) error {
	var signature manifestSignature
	if err := readJSON(signaturePath, &signature); err != nil {
		return err
	}
	if signature.Algorithm != signatureAlgorithm {
		return fmt.Errorf("unsupported signature algorithm %q", signature.Algorithm)
	}
	signed, valid := decodeSigningValue(signature.Signature, ed25519.SignatureSize)
	if !valid {
		return errors.New("invalid Ed25519 signature encoding")
	}
	var trusted struct {
		Keys []publicSigningKey `json:"keys"`
	}
	if err := readJSON(keysPath, &trusted); err != nil {
		return err
	}
	if len(trusted.Keys) == 0 {
		return errors.New("no trusted public keys configured")
	}
	for _, key := range trusted.Keys {
		if key.KeyID != signature.KeyID {
			continue
		}
		publicKey, valid := decodeSigningValue(key.PublicKey, ed25519.PublicKeySize)
		if !valid || signingKeyID(publicKey) != key.KeyID {
			return fmt.Errorf("invalid trusted public key for key_id %q", key.KeyID)
		}
		manifest, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if !ed25519.Verify(publicKey, manifest, signed) {
			return errors.New("Ed25519 signature verification failed")
		}
		return nil
	}
	return fmt.Errorf("unknown signing key_id %q", signature.KeyID)
}
