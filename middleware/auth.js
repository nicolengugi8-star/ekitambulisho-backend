const jwt = require('jsonwebtoken');

// The "door scanner" — checks if token is valid
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.status(401).json({
      success: false,
      message: 'No token provided. Please login.'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token. Please login again.'
      });
    }

    req.user = decoded;
    next();
  });
}

// Check if logged in user is a CHIEF
function isChief(req, res, next) {
  if (req.user.role !== 'chief') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Chiefs only.'
    });
  }
  next();
}

// Check if logged in user is an OFFICER
function isOfficer(req, res, next) {
  if (req.user.role !== 'officer') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Officers only.'
    });
  }
  next();
}

// Check if logged in user is an ADMIN
function isAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admins only.'
    });
  }
  next();
}

// Chief may only access their own ward
function enforceChiefWard(req, res, next) {
  const requestedWard = req.params.wardId;
  if (
    requestedWard != null &&
    String(requestedWard) !== String(req.user.wardId)
  ) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only view your assigned ward.'
    });
  }
  next();
}

// Officer may only access their assigned office
function enforceOfficerOffice(req, res, next) {
  const requestedOffice = req.params.officeId;
  if (
    requestedOffice != null &&
    String(requestedOffice) !== String(req.user.officeId)
  ) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only access your assigned office.'
    });
  }
  next();
}

module.exports = {
  verifyToken,
  isChief,
  isOfficer,
  isAdmin,
  enforceChiefWard,
  enforceOfficerOffice
};