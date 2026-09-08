const fs = require('fs');
require('dotenv').config();
const db = require('./config/database');

const rawData = fs.readFileSync('kenya_locations.json', 'utf8');
const data = JSON.parse(rawData);

async function importData() {
  const client = await db.connect();

  try {
    console.log('Connected!');

    // SAFETY CHECK — stop if data already exists
    const check = await client.query(
      'SELECT COUNT(*) FROM sub_counties'
    );

    if (parseInt(check.rows[0].count, 10) > 0) {
      console.log('');
      console.log('⚠️ Data already exists!');
      console.log('Sub counties:', check.rows[0].count);
      console.log('Stopping — will not run again.');
      console.log('');
      console.log(
        'To backfill missing county wards (e.g. Nairobi), run:'
      );
      console.log('  node scripts/import-nairobi-wards.js');
      console.log('');
      return;
    }

    console.log('Starting import...');

    const countyNames = Object.keys(data);

    await client.query('BEGIN');

    for (const countyName of countyNames) {

      const countyResult = await client.query(
        `SELECT county_id FROM counties 
         WHERE LOWER(county_name) = LOWER($1)`,
        [countyName]
      );

      if (countyResult.rows.length === 0) {
        console.log(`⚠️ Skipping: ${countyName}`);
        continue;
      }

      const countyId = countyResult.rows[0].county_id;
      console.log(`✅ ${countyName}`);

      const constituencies = data[countyName];
      const constituencyNames = Object.keys(constituencies);

      for (const constituencyName of constituencyNames) {

        const subResult = await client.query(
          `INSERT INTO sub_counties 
           (county_id, sub_county_name)
           VALUES ($1, $2) 
           RETURNING sub_county_id`,
          [countyId, constituencyName]
        );

        const subCountyId = subResult.rows[0].sub_county_id;
        const wardArray = constituencies[constituencyName];

        for (const wardName of wardArray) {
          await client.query(
            `INSERT INTO wards 
             (sub_county_id, ward_name)
             VALUES ($1, $2)`,
            [subCountyId, wardName]
          );
        }
      }
    }

    await client.query('COMMIT');

    console.log('');
    console.log('✅ Import complete!');

    const c1 = await client.query(
      'SELECT COUNT(*) FROM sub_counties'
    );
    const c2 = await client.query(
      'SELECT COUNT(*) FROM wards'
    );
    console.log('Sub counties:', c1.rows[0].count);
    console.log('Wards:', c2.rows[0].count);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await db.end();
  }
}

importData();