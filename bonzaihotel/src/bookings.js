const { docClient } = require("../initializers/dynamo");
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const serverless = require("serverless-http");
const { v4: uuid } = require("uuid");
const { initExpress } = require("../initializers/initExpress");
const { calculateDateDifference } = require("../functions/dateHelper");
const BOOKINGS_TABLE = process.env.BOOKINGS_TABLE;
const ROOMS_TABLE = process.env.ROOMS_TABLE;

const app = initExpress();

//* POST BOOKING
app.post("/bookings", async (req, res) => {
  const body = req.body;
  const { bookings } = body;

  try {
    let totalSum = 0;
    const roomsInfo = [];
    const clientName = bookings[0].clientName;
    const epost = bookings[0].epost;

    // First phase: validation for all bookings
    for (const booking of bookings) {
      const { roomId, checkIn, checkOut, guests } = booking;

      const roomParams = {
        TableName: ROOMS_TABLE,
        Key: { id: roomId },
      };

      const roomCommand = new GetCommand(roomParams);
      const foundRoom = await docClient.send(roomCommand);

      if (!foundRoom.Item) {
        throw new Error(`No room found with id: ${roomId}`);
      }

      if (foundRoom.Item.available == false) {
        throw new Error(`The room with id: ${roomId} is not available`);
      }

      // Validate guest amount
      const controlGuestAmount = (guests) => {
        let maxGuests;
        switch (foundRoom.Item.room) {
          case "single":
            maxGuests = 1;
            break;
          case "double":
            maxGuests = 2;
            break;
          case "suite":
            maxGuests = 3;
            break;
          default:
            maxGuests = 1;
        }
        if (guests > maxGuests) {
          throw new Error(
            `Too many guests for room id ${roomId}. Maximum allowed is ${maxGuests}`
          );
        }
      };

      controlGuestAmount(guests); // Validate the guest amount

      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);
      const days = calculateDateDifference(checkInDate, checkOutDate);
      const sum = Number(foundRoom.Item.price) * days;
      totalSum += sum;

      // Store room details in the booking
      roomsInfo.push({
        roomId: roomId,
        roomType: foundRoom.Item.room,
        guests: guests,
        checkIn: checkInDate.toISOString(),
        checkOut: checkOutDate.toISOString(),
        sum: sum,
      });
    }

    // Update room availability for all rooms
    for (const room of roomsInfo) {
      const updateRoomParams = {
        TableName: ROOMS_TABLE,
        Key: { id: room.roomId },
        UpdateExpression: "SET available = :available",
        ExpressionAttributeValues: {
          ":available": false,
        },
      };

      const updateRoomCommand = new UpdateCommand(updateRoomParams);
      await docClient.send(updateRoomCommand);
    }

    // Create one booking entry with multiple rooms
    const bookingId = uuid();
    const bookingEntry = {
      id: bookingId,
      clientName: clientName,
      epost: epost,
      totalSum: totalSum,
      rooms: roomsInfo,
      bookingDate: new Date().toISOString(),
    };

    // Save the booking to the BOOKINGS_TABLE
    const bookingParams = {
      TableName: BOOKINGS_TABLE,
      Item: bookingEntry,
    };

    const putCommand = new PutCommand(bookingParams);
    await docClient.send(putCommand);

    res.status(200).json({
      msg: "Rooms booked successfully under one booking",
      clientName: clientName,
      bookingId: bookingId,
      totalSum: totalSum,
      rooms: roomsInfo,
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

//* DELETE BOOKING
app.delete("/bookings/:bookingId", async (req, res) => {
  const { bookingId } = req.params;

  try {
    const getParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: bookingId },
    };

    const getCommand = new GetCommand(getParams);
    const booking = await docClient.send(getCommand);

    if (!booking.Item) {
      return res
        .status(404)
        .json({ msg: "No booking found with that bookingId", bookingId });
    }

    const checkInDate = new Date(booking.Item.checkIn);
    const currentDate = new Date();
    const timeDifference = checkInDate.getTime() - currentDate.getTime();
    // const daysDifference = timeDifference / (1000 * 3600 * 24);

    // if (daysDifference <= 2) {
    //   return res.status(400).json({
    //     msg: 'You cannot delete this booking. The check-in date is within 2 days.',
    //   });
    // }

    // Update room availability to true
    const bookedRooms = booking.Item.rooms;

    for (const room of bookedRooms) {
      const updateRoomParams = {
        TableName: ROOMS_TABLE,
        Key: { id: room.roomId },
        UpdateExpression: "SET available = :available",
        ExpressionAttributeValues: {
          ":available": true,
        },
      };

      const updateRoomCommand = new UpdateCommand(updateRoomParams);
      await docClient.send(updateRoomCommand);
    }
    const deleteParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: bookingId },
    };
    const deleteCommand = new DeleteCommand(deleteParams);
    await docClient.send(deleteCommand);

    res.status(200).json({ msg: `Booking ${bookingId} deleted successfully` });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

//* GET
app.get('/bookings/:id', async (req, res) => {
  const params = {
    TableName: BOOKINGS_TABLE,
  };

  try {
    const command = new ScanCommand(params);
    const { Items } = await docClient.send(command);

    if (Items) {
      // Calculate the total sum of all "sum" fields in the "rooms" array for each booking
      const totalSum = Items.reduce((total, item) => {
        return (
          total +
          item.rooms.reduce((roomTotal, room) => roomTotal + (room.sum || 0), 0)
        );
      }, 0);

      // Send response with total booking sum
      res.status(200).json({
        bookings: Items,
        totalBookingSum: totalSum,
      });
    }
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});


//* DELETE ROOM
app.delete("/bookings/rooms/:roomId", async (req, res) => {
  const { roomId } = req.params;

  try {
    // Scan the BOOKINGS_TABLE to retrieve all bookings
    const scanParams = {
      TableName: BOOKINGS_TABLE,
    };

    const scanCommand = new ScanCommand(scanParams);
    const bookings = await docClient.send(scanCommand);

    if (!bookings.Items || bookings.Items.length === 0) {
      return res.status(404).json({ msg: "No bookings found in the database" });
    }

    // Find the booking with roomId
    const booking = bookings.Items.find(
      (item) => item.rooms && item.rooms.some((room) => room.roomId === roomId)
    );

    if (!booking) {
      return res
        .status(404)
        .json({ msg: "Could not find the roomId inside any booking", roomId });
    }

    const bookingId = booking.id;

    // Remove the room from the booking's rooms array
    const updatedRooms = booking.rooms.filter((room) => room.roomId !== roomId);

    if (updatedRooms.length === 0) {
      // If no rooms are left, delete the booking
      const deleteParams = {
        TableName: BOOKINGS_TABLE,
        Key: { id: bookingId },
      };

      const deleteCommand = new DeleteCommand(deleteParams);
      await docClient.send(deleteCommand);

      return res.status(200).json({
        msg: `Booking ${bookingId} deleted successfully, as no rooms were left`,
      });
    }

    // Boolean to true
    const updateRoomParams = {
      TableName: ROOMS_TABLE,
      Key: { id: roomId },
      UpdateExpression: "SET available = :available",
      ExpressionAttributeValues: {
        ":available": true,
      },
    };
    const updateRoomCommand = new UpdateCommand(updateRoomParams);
    await docClient.send(updateRoomCommand);

    // Update the booking with the remaining rooms
    const updateBookingParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: bookingId },
      UpdateExpression: "SET rooms = :rooms",
      ExpressionAttributeValues: {
        ":rooms": updatedRooms,
      },
      ReturnValues: "ALL_NEW",
    };

    const updateBookingCommand = new UpdateCommand(updateBookingParams);
    const updatedBooking = await docClient.send(updateBookingCommand);

    res.status(200).json({
      msg: `Room ${roomId} removed from booking ${bookingId} successfully`,
      updatedBooking: updatedBooking.Attributes,
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

//* PUT BOOKING
app.put("/bookings/:id", async (req, res) => {
  const { id } = req.params;
  const { roomId, newRoomId, guests, checkIn, checkOut } = req.body;

  try {
    // Retrieve the booking details first
    const bookingParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: id },
    };
    const getBookingCommand = new GetCommand(bookingParams);
    const booking = await docClient.send(getBookingCommand);

    if (!booking.Item) {
      return res.status(404).json({ msg: "Booking not found" });
    }

    let updatedRoomId = roomId; // Default to the roomId provided in the body

    // If user wants to change a room, find and update the new room details
    if (newRoomId) {
      const newRoomParams = {
        TableName: ROOMS_TABLE,
        Key: { id: newRoomId },
      };
      const getNewRoomCommand = new GetCommand(newRoomParams);
      const foundNewRoom = await docClient.send(getNewRoomCommand);

      if (!foundNewRoom.Item) {
        return res.status(404).json({ msg: "New room not found" });
      }

      // Mark the old room as available
      const updateOldRoomParams = {
        TableName: ROOMS_TABLE,
        Key: { id: roomId },
        UpdateExpression: "SET available = :available",
        ExpressionAttributeValues: {
          ":available": true,
        },
      };
      const updateOldRoomCommand = new UpdateCommand(updateOldRoomParams);
      await docClient.send(updateOldRoomCommand);

      // Mark the new room as unavailable
      const updateNewRoomParams = {
        TableName: ROOMS_TABLE,
        Key: { id: newRoomId },
        UpdateExpression: "SET available = :available",
        ExpressionAttributeValues: {
          ":available": false,
        },
      };
      const updateNewRoomCommand = new UpdateCommand(updateNewRoomParams);
      await docClient.send(updateNewRoomCommand);

      updatedRoomId = newRoomId; // Set roomId to the new roomId
    }

    // Fetch the updated room
    const roomParams = {
      TableName: ROOMS_TABLE,
      Key: { id: updatedRoomId },
    };
    const getRoomCommand = new GetCommand(roomParams);
    const foundRoom = await docClient.send(getRoomCommand);

    if (!foundRoom.Item) {
      return res.status(404).json({ msg: "Room not found" });
    }

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const days = calculateDateDifference(checkInDate, checkOutDate);
    const totalSum = Number(foundRoom.Item.price) * days;

    // Find the index of the room to update in the rooms array
    let updatedRoomsArray = booking.Item.rooms || [];
    const roomIndex = updatedRoomsArray.findIndex(
      (room) => room.roomId === roomId
    );

    if (roomIndex !== -1) {
      // If the room is already in the array, replace it
      updatedRoomsArray[roomIndex] = {
        roomId: updatedRoomId,
        guests: guests,
        checkIn: checkIn,
        checkOut: checkOut,
        sum: totalSum,
        roomType: foundRoom.Item.room,
      };
    } else {
      // If the room is not in the array, add it
      updatedRoomsArray.push({
        roomId: updatedRoomId,
        guests: guests,
        checkIn: checkIn,
        checkOut: checkOut,
        sum: totalSum,
        roomType: foundRoom.Item.room,
      });
    }

    // Update the booking entry in the database with the updated rooms array
    const updateBookingParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: id },
      UpdateExpression:
        "SET rooms = :rooms, guests = :guests, checkIn = :checkIn, checkOut = :checkOut, totalSum = :totalSum ",
      ExpressionAttributeValues: {
        ":rooms": updatedRoomsArray,
        ":guests": guests,
        ":checkIn": checkIn,
        ":checkOut": checkOut,
        ":totalSum": totalSum,
      },
      ReturnValues: "ALL_NEW",
    };

    const updateBookingCommand = new UpdateCommand(updateBookingParams);
    const result = await docClient.send(updateBookingCommand);

    res.status(200).json({
      msg: "Booking updated successfully",
      updatedBooking: result.Attributes,
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

//*GET BOOKING

app.get("/bookings", async (req, res) => {
  const params = {
    TableName: BOOKINGS_TABLE,
  };

  try {
    const command = new ScanCommand(params);
    const { Items } = await docClient.send(command);
    if (Items) {
      res.status(200).json(Items);
    }
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

exports.handler = serverless(app);
