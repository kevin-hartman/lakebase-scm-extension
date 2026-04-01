require('dotenv').config();

// Parse JDBC URL (from .env SPRING_DATASOURCE_URL) or use DATABASE_URL directly
function getConnectionString() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) return dbUrl;

  const jdbc = process.env.SPRING_DATASOURCE_URL || '';
  if (jdbc.startsWith('jdbc:postgresql://')) {
    return jdbc.replace('jdbc:postgresql://', 'postgresql://');
  }
  return 'postgresql://localhost:5432/databricks_postgres';
}

module.exports = {
  client: 'pg',
  connection: {
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false },
  },
  migrations: {
    directory: './migrations',
  },
};
