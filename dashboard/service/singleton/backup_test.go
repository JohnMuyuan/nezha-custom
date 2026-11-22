package singleton

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/nezhahq/nezha/model"
)

func TestOpenSSLCompatibleEncryptDecrypt(t *testing.T) {
	plain := []byte("nezha-backup-payload-test-数据完整性校验-1234567890")
	enc, err := EncryptOpenSSLCompatible(plain, "MyStrongPass#2026")
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if !IsOpenSSLEncrypted(enc) {
		t.Fatal("expected OpenSSL Salted__ header")
	}

	dec, err := DecryptOpenSSLCompatible(enc, "MyStrongPass#2026")
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if !bytes.Equal(plain, dec) {
		t.Fatalf("decrypted mismatch: got %q, want %q", dec, plain)
	}

	if _, err := DecryptOpenSSLCompatible(enc, "WrongPassword"); err == nil {
		t.Fatal("expected decryption with wrong password to fail")
	}
}

func TestBackupArchiveAndRestoreRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "config.yaml")
	dbPath := filepath.Join(tmpDir, "sqlite.db")

	origCfg := "site_name: 测试探针\ninstall_host: nzzz.yp.fyi:20070\nlisten_port: 20070\nagent_secret_key: secret-abc\n"
	if err := os.WriteFile(cfgPath, []byte(origCfg), 0600); err != nil {
		t.Fatal(err)
	}

	testDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite failed: %v", err)
	}
	if err := testDB.AutoMigrate(&model.BackupConfig{}); err != nil {
		t.Fatalf("automigrate failed: %v", err)
	}
	if err := testDB.Create(&model.BackupConfig{ID: 1, ScheduleHour: 3, ScheduleMinute: 15}).Error; err != nil {
		t.Fatalf("seed db failed: %v", err)
	}

	prevDB, prevCfgPath, prevDBPath, prevConf := DB, ConfigFilePath, DatabaseFilePath, Conf
	defer func() {
		DB = prevDB
		ConfigFilePath = prevCfgPath
		DatabaseFilePath = prevDBPath
		Conf = prevConf
	}()

	DB = testDB
	ConfigFilePath = cfgPath
	DatabaseFilePath = dbPath
	testConf := &model.Config{}
	testConf.SiteName = "测试探针"
	testConf.InstallHost = "nzzz.yp.fyi:20070"
	testConf.ListenPort = 20070
	Conf = &ConfigClass{
		Config: testConf,
	}

	bc := &BackupClass{
		cfg:         defaultBackupConfig(),
		restartHook: func() {}, // no-op in tests
	}

	// 1. Export encrypted archive using VACUUM INTO
	encArchive, filename, encrypted, manifest, err := bc.CreateBackupArchive(false, "BackupSecret99")
	if err != nil {
		t.Fatalf("CreateBackupArchive failed: %v", err)
	}
	if !encrypted || !strings.HasSuffix(filename, ".tar.gz.enc") {
		t.Fatalf("expected encrypted .tar.gz.enc filename, got %s (encrypted=%v)", filename, encrypted)
	}
	if manifest.ListenPort != 20070 || manifest.InstallHost != "nzzz.yp.fyi:20070" {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}

	// 2. Close SQLite handle so Windows allows overwriting dbPath during restore test
	if sqlDB, err := testDB.DB(); err == nil {
		_ = sqlDB.Close()
	}
	DB = nil

	// Corrupt/change config.yaml so we can verify restore actually brings original back
	if err := os.WriteFile(cfgPath, []byte("site_name: modified\n"), 0600); err != nil {
		t.Fatal(err)
	}

	// 3. Reject wrong password
	if _, _, err := bc.RestoreFromArchive(encArchive, "badpass"); err == nil {
		t.Fatal("expected RestoreFromArchive to fail with wrong password")
	}

	// 4. Restore with correct password
	preDir, restoredMf, err := bc.RestoreFromArchive(encArchive, "BackupSecret99")
	if err != nil {
		t.Fatalf("RestoreFromArchive failed: %v", err)
	}
	if restoredMf == nil || restoredMf.SiteName != "测试探针" {
		t.Fatalf("unexpected restored manifest: %+v", restoredMf)
	}
	if _, err := os.Stat(filepath.Join(preDir, "config.yaml")); err != nil {
		t.Fatalf("expected pre-restore snapshot in %s, got %v", preDir, err)
	}
	gotCfg, err := os.ReadFile(cfgPath)
	if err != nil || string(gotCfg) != origCfg {
		t.Fatalf("restored config.yaml mismatch: got %q, want %q", string(gotCfg), origCfg)
	}

	// 5. Reject zip-slip tar archive
	var evilBuf bytes.Buffer
	gzw := gzip.NewWriter(&evilBuf)
	tw := tar.NewWriter(gzw)
	_ = tw.WriteHeader(&tar.Header{Name: "../../etc/evil", Mode: 0600, Size: 4})
	_, _ = tw.Write([]byte("evil"))
	_ = tw.Close()
	_ = gzw.Close()
	if _, _, err := bc.RestoreFromArchive(evilBuf.Bytes(), ""); err == nil {
		t.Fatal("expected zip-slip tar archive to be rejected")
	}

	// 6. Reject shell injection in BatchMigrateAgentEndpoint
	if _, err := bc.BatchMigrateAgentEndpoint(context.Background(), []uint64{1}, "evil.com:20070;rm -rf /", false); err == nil {
		t.Fatal("expected shell injection in new_server to be rejected")
	}
}
