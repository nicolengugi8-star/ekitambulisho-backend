function getCountyScope(user) {
  if (
    user &&
    user.adminLevel === 'county_admin' &&
    user.countyId != null &&
    user.countyId !== ''
  ) {
    return user.countyId;
  }
  return null;
}

module.exports = { getCountyScope };
