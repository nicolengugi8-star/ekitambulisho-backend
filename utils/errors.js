function serverError(res, error, message) {
  console.error(error);
  res.status(500).json({
    success: false,
    message: message || 'An unexpected error occurred. Please try again.'
  });
}

module.exports = { serverError };
