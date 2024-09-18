const { docClient } = require("../initializers/dynamo");
const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const serverless = require("serverless-http");
const { v4: uuid } = require("uuid");
const { initExpress } = require("../initializers/initExpress");
const { calculateDateDifference } = require("../functions/dateHelper");

const BOOKINGS_TABLE = process.env.BOOKINGS_TABLE;
const ROOMS_TABLE = process.env.ROOMS_TABLE;

const app = initExpress();

app.post('/bookings', async (req, res) => {
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
        UpdateExpression: 'SET available = :available',
        ExpressionAttributeValues: {
          ':available': false,
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
      msg: 'Rooms booked successfully under one booking',
      bookingId: bookingId,
      totalSum: totalSum,
      rooms: roomsInfo,
    });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

// DELETE BOOKING
app.delete("/bookings/:bookingId", async (req, res) => {
  const { bookingId } = req.params;

  try {
    // Retrieve the booking details
    const getParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: bookingId },
    };

    const getCommand = new GetCommand(getParams);
    const booking = await docClient.send(getCommand);

    if (!booking.Item) {
      return res
        .status(404)
        .json({ msg: 'No booking found with that bookingId', bookingId });
    }

    const checkInDate = new Date(booking.Item.checkIn);
    const currentDate = new Date();
    const timeDifference = checkInDate.getTime() - currentDate.getTime();
    const daysDifference = timeDifference / (1000 * 3600 * 24);

    if (daysDifference <= 2) {
      return res.status(400).json({
        msg: 'You cannot delete this booking. The check-in date is within 2 days.',
      });
    }
    const bookedRooms = booking.Item.rooms;

    // Update room availability to true
    for (const room of bookedRooms) {
      const updateRoomParams = {
        TableName: ROOMS_TABLE,
        Key: { id: room.roomId },
        UpdateExpression: 'SET available = :available',
        ExpressionAttributeValues: {
          ':available': true,
        },
      };

      const updateRoomCommand = new UpdateCommand(updateRoomParams);
      await docClient.send(updateRoomCommand);
    }
    const deleteParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id: bookingId},
    }
    const deleteCommand = new DeleteCommand(deleteParams);
    await docClient.send(deleteCommand);

    res
      .status(200)
      .json({ msg: `Booking ${bookingId} deleted successfully` });
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

app.get("/bookings/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const params = {
      TableName: BOOKINGS_TABLE,
      Key: { id },
    };

    const command = new GetCommand(params);
    const { Item: bookingInfo } = await docClient.send(command);
    if (bookingInfo) {
      res.status(200).json({ bookingid: id, bookingInfo });
    } else {
      res.status(404).json({ msg: "Booking not found" });
    }
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

exports.handler = serverless(app);

// app.post("/bookings/:roomId", async (req, res) => {
//   const body = req.body;
//   const { roomId } = req.params;
//   const checkIn = new Date(body.checkIn);
//   const checkOut = new Date(body.checkOut);
//   const { clientName, guests } = req.body;

//   const roomParams = {
//     TableName: ROOMS_TABLE,
//     Key: { id: roomId },
//   };

//   const roomCommand = new GetCommand(roomParams);
//   const foundRoom = await docClient.send(roomCommand);

//   if (!foundRoom.Item) {
//     return res.status(404).json({ msg: "No room found with that id" });
//   }

//   const controlGuestAmount = (guests) => {
//     let maxGuests;
//     switch (foundRoom.Item.room) {
//       case "single":
//         maxGuests = 1;
//         break;
//       case "double":
//         maxGuests = 2;
//         break;
//       case "suite":
//         maxGuests = 3;
//         break;
//       default:
//         maxGuests = 1;
//     }
//     if (guests > maxGuests) {
//       throw new Error(`Too many guests. Maximum allowed is ${maxGuests}`);
//     }
//   };

//   const days = calculateDateDifference(checkIn, checkOut);
//   const sum = Number(foundRoom.Item.price) * days;
//   try {
//     controlGuestAmount(guests);

//     const order = {
//       id: uuid(),
//       roomId: roomId,
//       days: days,
//       checkIn: checkIn.toISOString(),
//       checkOut: checkOut.toISOString(),
//       sum: sum,
//       clientName: clientName,
//       guests: guests,
//     };

//     const bookingParams = {
//       TableName: BOOKINGS_TABLE,
//       Item: order,
//     };
//     const bookingCommand = new PutCommand(bookingParams);
//     await docClient.send(bookingCommand);

//     // Update the room availability
//     const updateRoomParams = {
//       TableName: ROOMS_TABLE,
//       Key: { id: roomId },
//       UpdateExpression: "SET available = :available",
//       ExpressionAttributeValues: {
//         ":available": false,
//       },
//     };

//     const updateRoomCommand = new UpdateCommand(updateRoomParams);
//     await docClient.send(updateRoomCommand);

//     res.status(200).json({
//       msg: "Room booked successfully",
//       orderId: order.id,
//       roomId: roomId,
//     });
//   } catch (error) {
//     res.status(500).json({ msg: error.message });
//   }
// });
