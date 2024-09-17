const calculateDateDifference = (checkIn, checkOut) => {
  const difference = checkOut.getTime() - checkIn.getTime();

  return difference / (1000 * 3600 * 24);
};

module.exports = { calculateDateDifference };
