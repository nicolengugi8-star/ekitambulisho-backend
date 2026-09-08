const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET all counties
router.get('/counties', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT county_id, county_name 
       FROM counties 
       ORDER BY county_name`
    );
    res.json({
      success: true,
      counties: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET sub counties by county
router.get('/sub-counties/:countyId', 
async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sub_county_id, sub_county_name
       FROM sub_counties
       WHERE county_id = $1
       ORDER BY sub_county_name`,
      [req.params.countyId]
    );
    res.json({
      success: true,
      subCounties: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET wards by sub county
router.get('/wards/:subCountyId', 
async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ward_id, ward_name
       FROM wards
       WHERE sub_county_id = $1
       ORDER BY ward_name`,
      [req.params.subCountyId]
    );
    res.json({
      success: true,
      wards: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;