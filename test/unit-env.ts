// Unit tests never connect to a database; placeholder DB settings let
// src/config/database.config.ts load without a .env
process.env.DB_USERNAME ??= 'unit-test';
process.env.DB_PASSWORD ??= 'unit-test';
process.env.DB_NAME ??= 'unit-test';
