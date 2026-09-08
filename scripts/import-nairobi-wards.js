/**
 * Backfill Nairobi (county_id 47) wards from kenya_locations.json.
 * Use when sub_counties exist but wards were never imported (Nairobi was
 * missing from the dataset when import.js first ran).
 *
 * Usage: node scripts/import-nairobi-wards.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const COUNTY_NAME = 'Nairobi';
const LOCATIONS_FILE = path.join(__dirname, '..', 'kenya_locations.json');

async function wardExists(client, subCountyId, wardName) {
  const result = await client.query(
    `SELECT ward_id
     FROM wards
     WHERE sub_county_id = $1
     AND LOWER(TRIM(ward_name)) = LOWER(TRIM($2))
     LIMIT 1`,
    [subCountyId, wardName]
  );
  return result.rows.length > 0;
}

async function importNairobiWards() {
  const rawData = fs.readFileSync(LOCATIONS_FILE, 'utf8');
  const data = JSON.parse(rawData);
  const nairobi = data[COUNTY_NAME];

  if (!nairobi) {
    throw new Error(`"${COUNTY_NAME}" not found in kenya_locations.json`);
  }

  const client = await db.connect();
  let inserted = 0;
  let skipped = 0;
  const affectedSubCounties = new Set();

  try {
    await client.query('BEGIN');

    const countyResult = await client.query(
      `SELECT county_id FROM counties WHERE LOWER(county_name) = LOWER($1)`,
      [COUNTY_NAME]
    );

    if (countyResult.rows.length === 0) {
      throw new Error(`County "${COUNTY_NAME}" not found in database`);
    }

    const countyId = countyResult.rows[0].county_id;

    for (const [subCountyName, wardNames] of Object.entries(nairobi)) {
      const subResult = await client.query(
        `SELECT sub_county_id
         FROM sub_counties
         WHERE county_id = $1
         AND LOWER(TRIM(sub_county_name)) = LOWER(TRIM($2))`,
        [countyId, subCountyName]
      );

      if (subResult.rows.length === 0) {
        throw new Error(
          `Sub-county "${subCountyName}" not found for ${COUNTY_NAME} (county_id ${countyId})`
        );
      }

      const subCountyId = subResult.rows[0].sub_county_id;

      for (const wardName of wardNames) {
        const exists = await wardExists(client, subCountyId, wardName);
        if (exists) {
          skipped += 1;
          continue;
        }

        await client.query(
          `INSERT INTO wards (sub_county_id, ward_name)
           VALUES ($1, $2)`,
          [subCountyId, wardName]
        );
        inserted += 1;
        affectedSubCounties.add(subCountyName);
      }
    }

    await client.query('COMMIT');

    console.log('');
    console.log('=== NAIROBI WARD IMPORT COMPLETE ===');
    console.log(`Inserted: ${inserted}`);
    console.log(`Skipped (already existed): ${skipped}`);
    console.log(`Sub-counties affected: ${affectedSubCounties.size}`);
    console.log('');

    return { inserted, skipped, affectedSubCounties: [...affectedSubCounties] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verify() {
  const subCounties = await db.query(
    `SELECT sub_county_id, sub_county_name
     FROM sub_counties
     WHERE county_id = 47
     ORDER BY sub_county_id`
  );
  console.log('=== NAIROBI SUB-COUNTIES ===');
  console.log(JSON.stringify(subCounties.rows, null, 2));

  const wards = await db.query(
    `SELECT w.ward_id, w.ward_name, w.sub_county_id, sc.sub_county_name
     FROM wards w
     JOIN sub_counties sc ON w.sub_county_id = sc.sub_county_id
     WHERE sc.county_id = 47
     ORDER BY sc.sub_county_id, w.ward_name`
  );
  console.log('=== NAIROBI WARDS ===');
  console.log(JSON.stringify(wards.rows, null, 2));
  console.log(`Total Nairobi wards: ${wards.rows.length}`);

  const counts = await db.query(
    `SELECT sc.sub_county_id, sc.sub_county_name, COUNT(w.ward_id)::int AS ward_count
     FROM sub_counties sc
     LEFT JOIN wards w ON w.sub_county_id = sc.sub_county_id
     WHERE sc.county_id = 47
     GROUP BY sc.sub_county_id, sc.sub_county_name
     ORDER BY sc.sub_county_id`
  );
  console.log('=== WARD COUNT BY SUB-COUNTY ===');
  console.log(JSON.stringify(counts.rows, null, 2));

  await db.end();
}

importNairobiWards()
  .then(() => verify())
  .catch(async (error) => {
    console.error('Import failed:', error.message);
    await db.end();
    process.exit(1);
  });
