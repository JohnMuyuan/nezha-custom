package geoip

import (
	_ "embed"
	"errors"
	"net"
	"strings"
	"sync"

	maxminddb "github.com/oschwald/maxminddb-golang"
)

//go:embed geoip.db
var db []byte

var (
	dbOnce = sync.OnceValues(func() (*maxminddb.Reader, error) {
		db, err := maxminddb.FromBytes(db)
		if err != nil {
			return nil, err
		}
		return db, nil
	})
)

type IPInfo struct {
	Country       string `maxminddb:"country"`
	CountryCode   string `maxminddb:"country_code"`
	CountryName   string `maxminddb:"country_name"`
	Continent     string `maxminddb:"continent"`
	ContinentCode string `maxminddb:"continent_code"`
	ContinentName string `maxminddb:"continent_name"`
}

type maxMindCountryRecord struct {
	Country struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"country"`
	RegisteredCountry struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"registered_country"`
	Continent struct {
		Code string `maxminddb:"code"`
	} `maxminddb:"continent"`
}

func Lookup(ip net.IP) (string, error) {
	db, err := dbOnce()
	if err != nil {
		return "", err
	}

	var mmRecord maxMindCountryRecord
	if err := db.Lookup(ip, &mmRecord); err == nil {
		if mmRecord.Country.ISOCode != "" {
			return strings.ToLower(mmRecord.Country.ISOCode), nil
		}
		if mmRecord.RegisteredCountry.ISOCode != "" {
			return strings.ToLower(mmRecord.RegisteredCountry.ISOCode), nil
		}
		if mmRecord.Continent.Code != "" {
			return strings.ToLower(mmRecord.Continent.Code), nil
		}
	}

	var record IPInfo
	err = db.Lookup(ip, &record)
	if err != nil {
		return "", err
	}

	if record.CountryCode != "" {
		return strings.ToLower(record.CountryCode), nil
	}
	if len(record.Country) == 2 {
		return strings.ToLower(record.Country), nil
	}
	if record.ContinentCode != "" {
		return strings.ToLower(record.ContinentCode), nil
	}
	if len(record.Continent) == 2 {
		return strings.ToLower(record.Continent), nil
	}
	if record.Country != "" {
		return strings.ToLower(record.Country), nil
	}
	if record.Continent != "" {
		return strings.ToLower(record.Continent), nil
	}

	return "", errors.New("IP not found")
}
