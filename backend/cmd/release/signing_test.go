package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestManifestSigning(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "release-manifest.json")
	signaturePath := manifestPath + ".sig"
	keyPath := filepath.Join(dir, "seed")
	keysPath := filepath.Join(dir, "keys.json")
	data := []byte("{ \"manifest_version\": 1 }\n")
	writeSigningFixture(t, manifestPath, data)

	key, seed := signingFixture(t, keyPath)
	other, _ := signingFixture(t, filepath.Join(dir, "other-seed"))
	writeSigningFixture(t, keysPath, signingKeysJSON(t, other, key))

	check := func(args ...string) {
		t.Helper()
		if err := run(args); err != nil {
			t.Fatal(err)
		}
	}
	check("sign", manifestPath, keyPath)
	fileSignature, err := os.ReadFile(signaturePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(signingKeyEnv, string(seed))
	check("sign", manifestPath, "-")
	envSignature, err := os.ReadFile(signaturePath)
	if err != nil || !bytes.Equal(envSignature, fileSignature) {
		t.Fatalf("signing using the environment differs from signing using the file: %v", err)
	}
	check("verify", manifestPath, signaturePath, keysPath)

	var signature manifestSignature
	if err := json.Unmarshal(fileSignature, &signature); err != nil {
		t.Fatal(err)
	}
	if signature.KeyID != key.KeyID || signature.Algorithm != "ed25519" {
		t.Fatalf("unexpected signature metadata: %+v", signature)
	}
	public, err := base64.StdEncoding.DecodeString(key.PublicKey)
	if err != nil || len(public) != ed25519.PublicKeySize {
		t.Fatal("invalid public key")
	}
	raw, err := base64.StdEncoding.DecodeString(signature.Signature)
	if err != nil || signature.Signature != base64.StdEncoding.EncodeToString(raw) ||
		!ed25519.Verify(public, data, raw) {
		t.Fatal("expected a padded Ed25519 signature over the exact manifest bytes")
	}

	for _, tc := range []struct {
		name, want string
		keys       []publicSigningKey
		change     func(*manifestSignature)
		manifest   []byte
	}{
		{name: "wrong key", keys: []publicSigningKey{other}, change: func(s *manifestSignature) { s.KeyID = other.KeyID }, want: "signature verification failed"},
		{name: "unknown key_id", keys: []publicSigningKey{other}, want: "unknown signing key_id"},
		{name: "tampered manifest", keys: []publicSigningKey{key}, manifest: bytes.TrimSpace(data), want: "signature verification failed"},
		{name: "wrong algorithm", keys: []publicSigningKey{key}, change: func(s *manifestSignature) { s.Algorithm = "Ed25519" }, want: "unsupported signature algorithm"},
		{name: "empty key list", keys: []publicSigningKey{}, want: "no trusted public keys configured"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			modified := signature
			if tc.change != nil {
				tc.change(&modified)
			}
			manifest := data
			if tc.manifest != nil {
				manifest = tc.manifest
			}
			writeSigningFixture(t, manifestPath, manifest)
			writeSigningFixture(t, signaturePath, signingJSON(t, modified))
			writeSigningFixture(t, keysPath, signingKeysJSON(t, tc.keys...))
			err := run([]string{"verify", manifestPath, signaturePath, keysPath})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
		})
	}
}

func TestKeygenRefusesOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "seed")
	_, original := signingFixture(t, path)
	var output bytes.Buffer
	if err := generateSigningKey(path, &output); !errors.Is(err, os.ErrExist) || output.Len() != 0 {
		t.Fatalf("expected existing-file error without public key output, got %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, original) {
		t.Fatalf("existing seed file was changed: %v", err)
	}
}

func TestManifestSigningRequiresEnvironmentKey(t *testing.T) {
	t.Setenv(signingKeyEnv, "")
	err := run([]string{"sign", filepath.Join(t.TempDir(), "release-manifest.json"), "-"})
	if err == nil || !strings.Contains(err.Error(), "ATLAS_RELEASE_SIGNING_KEY is required") {
		t.Fatalf("expected missing secret error, got %v", err)
	}
}

func signingFixture(t *testing.T, path string) (publicSigningKey, []byte) {
	t.Helper()
	var out bytes.Buffer
	if err := generateSigningKey(path, &out); err != nil {
		t.Fatal(err)
	}
	var key publicSigningKey
	if err := json.Unmarshal(out.Bytes(), &key); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("seed permissions = %o, want 0600", info.Mode().Perm())
	}
	file, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSuffix(string(file), "\n"))
	if err != nil || len(seed) != ed25519.SeedSize || string(file) != base64.StdEncoding.EncodeToString(seed)+"\n" {
		t.Fatal("expected a single line containing a base64 seed")
	}
	pub := ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
	sum := sha256.Sum256(pub)
	if key.PublicKey != base64.StdEncoding.EncodeToString(pub) || key.KeyID != fmt.Sprintf("%x", sum)[:16] {
		t.Fatal("keygen output does not identify the public key derived from the seed")
	}
	return key, file
}

func writeSigningFixture(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
}

func signingKeysJSON(t *testing.T, keys ...publicSigningKey) []byte {
	t.Helper()
	return signingJSON(t, map[string][]publicSigningKey{"keys": append([]publicSigningKey{}, keys...)})
}

func signingJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
