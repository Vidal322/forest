package config

import (
	"os"
)

type Config struct {
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
	ServerPort string
}

func Load() Config {
	return Config{
		DBHost:     getEnv("POSTGRES_HOST", "localhost"),
		DBPort:     getEnv("POSTGRES_PORT", "5432"),
		DBUser:     getEnv("POSTGRES_USER", "postgres"),
		DBPassword: getEnv("POSTGRES_PASSWORD", ""),
		DBName:     getEnv("POSTGRES_DB", "postgres"),
		ServerPort: getEnv("SERVER_PORT", "8080"),
	}
}

func getEnv(key, defaultValue string) string {

	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
