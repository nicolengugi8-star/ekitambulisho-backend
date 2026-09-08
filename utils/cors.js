function parseCorsOrigins(value) {
  const defaultOrigins = ['http://localhost:3000'];
  if (!value || !String(value).trim()) {
    return defaultOrigins;
  }
  return String(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

module.exports = { parseCorsOrigins };
