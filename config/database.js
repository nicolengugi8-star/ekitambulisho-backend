const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.log('❌ Database connection failed!');
    console.log(err.message);
  } else {
    console.log('✅ Database connected successfully!');
    release();
  }
});

module.exports = pool;