const multer = require('multer');
const path = require('path');

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/pdf'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(
      'Wrong file type! Only JPG PNG and PDF allowed'
    ), false);
  }
};

const uploadBirthCert = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) {
      cb(null, './uploads/birth-certificates');
    },
    filename: function(req, file, cb) {
      const uniqueName =
        Date.now() + '-' +
        Math.round(Math.random() * 1000) +
        path.extname(file.originalname);
      cb(null, uniqueName);
    }
  }),
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadForeignerDocs = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) {
      cb(null, './uploads/foreigner-documents');
    },
    filename: function(req, file, cb) {
      const uniqueName =
        Date.now() + '-' +
        Math.round(Math.random() * 1000) +
        path.extname(file.originalname);
      cb(null, uniqueName);
    }
  }),
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadPoliceAbstract = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) {
      cb(null, './uploads/police-abstracts');
    },
    filename: function(req, file, cb) {
      const uniqueName =
        Date.now() + '-' +
        Math.round(Math.random() * 1000) +
        path.extname(file.originalname);
      cb(null, uniqueName);
    }
  }),
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

module.exports = {
  uploadBirthCert,
  uploadForeignerDocs,
  uploadPoliceAbstract
};