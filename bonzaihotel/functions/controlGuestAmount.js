const controlGuestAmount = (guests, foundRoom) => {
  let maxGuests;
  switch (foundRoom.Item.room) {
    case 'single':
      maxGuests = 1;
      break;
    case 'double':
      maxGuests = 2;
      break;
    case 'suite':
      maxGuests = 3;
      break;
    default:
      maxGuests = 1;
  }
  if (guests > maxGuests) {
    throw new Error(
      `Too many guests for room id ${foundRoom.Item.id}. Maximum allowed is ${maxGuests}`
    );
  }
};

module.exports = {
  controlGuestAmount,
};
