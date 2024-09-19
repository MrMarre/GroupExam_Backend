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
const { controlGuestAmount } = require("../functions/controlGuestAmount");
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

      controlGuestAmount(guests, foundRoom);

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

//* GET
app.get("/bookings/:id", async (req, res) => {
  const { id } = req.params;
  const params = {
    TableName: BOOKINGS_TABLE,
  };

  try {
    const command = new GetCommand(params);
    const { Item: bookingInfo } = await docClient.send(command);
    if (bookingInfo) {
      res.status(200).json({ bookingid: id, bookingInfo });
    } else {
      res.status(404).json({ msg: "Booking not found" });
      if (Items) {
        // Calculate the total sum of all "sum" fields in the "rooms" array for each booking
        const totalSum = Items.reduce((total, item) => {
          return (
            total +
            item.rooms.reduce(
              (roomTotal, room) => roomTotal + (room.sum || 0),
              0
            )
          );
        }, 0);

        // Send response with total booking sum
        res.status(200).json({
          bookings: Items,
          totalBookingSum: totalSum,
        });
      }
    }
  } catch (error) {
    res.status(500).json({ msg: error.message });
  }
});

//* DELETE ROOM
app.delete("/bookings/:id", async (req, res) => {
  const { id } = req.params;
  const { roomId } = req.body;

  try {
    const getParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id },
    };

    const getCommand = new GetCommand(getParams);
    const { Item } = await docClient.send(getCommand);

    if (!Item) {
      return res.status(404).json({ msg: "Booking not found" });
    }

    const currentDate = new Date();

    // Function to update room availability
    const updateRoomAvailability = async (roomId) => {
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
    };

    //if no roomId is provided, delete the booking instead
    if (!roomId) {
      //check if all rooms have at least 2 days left until checkOut
      for (const room of Item.rooms) {
        const roomCheckOutDate = new Date(room.checkOut);
        const timeDifference =
          roomCheckOutDate.getTime() - currentDate.getTime();
        const daysDifference = timeDifference / (1000 * 3600 * 24);

        if (daysDifference <= 2) {
          return res.status(400).json({
            msg: `Cannot delete booking. Room ${room.roomId} has a check-out date within 2 days.`,
          });
        }
      }

      // Loop through all rooms and set them to available
      for (const room of Item.rooms) {
        await updateRoomAvailability(room.roomId);
      }

      const deleteParams = {
        TableName: BOOKINGS_TABLE,
        Key: { id },
      };

      const deleteCommand = new DeleteCommand(deleteParams);
      await docClient.send(deleteCommand);

      return res
        .status(200)
        .json({ msg: `Booking ${id} deleted successfully` });
    }

    //if roomId is provided, find and remove specific room
    const foundRoom = Item.rooms.find((room) => room.roomId === roomId);
    if (!foundRoom) {
      return res
        .status(404)
        .json({ msg: `Room with roomId ${roomId} not found in booking ${id}` });
    }

    const updatedRooms = Item.rooms.filter((room) => room.roomId !== roomId);

    // Check if the specific room has at least 2 days left until checkOut
    const roomCheckOutDate = new Date(foundRoom.checkOut);
    const timeDifference = roomCheckOutDate.getTime() - currentDate.getTime();
    const daysDifference = timeDifference / (1000 * 3600 * 24);

    if (daysDifference <= 2) {
      return res.status(400).json({
        msg: `Cannot delete room ${roomId}. The check-out date is within 2 days.`,
      });
    }

    // Mark the room as available
    await updateRoomAvailability(roomId);

    if (updatedRooms.length === 0) {
      const deleteBookingParams = {
        TableName: BOOKINGS_TABLE,
        Key: { id },
      };

      const deleteBookingCommand = new DeleteCommand(deleteBookingParams);
      await docClient.send(deleteBookingCommand);

      return res
        .status(200)
        .json({ msg: `Booking ${id} deleted as no rooms were left` });
    }

    // Update the booking with remaining rooms
    const updateBookingParams = {
      TableName: BOOKINGS_TABLE,
      Key: { id },
      UpdateExpression: "SET rooms = :rooms",
      ExpressionAttributeValues: {
        ":rooms": updatedRooms,
      },
      ReturnValues: "ALL_NEW",
    };

    const updateBookingCommand = new UpdateCommand(updateBookingParams);
    const updatedBooking = await docClient.send(updateBookingCommand);

    return res.status(200).json({
      msg: `Room ${roomId} removed from booking ${id} successfully`,
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
    if (roomParams.Item) {
    }
    const getRoomCommand = new GetCommand(roomParams);
    const foundRoom = await docClient.send(getRoomCommand);

    if (!foundRoom.Item) {
      return res.status(404).json({ msg: "Room not found" });
    }
    controlGuestAmount(guests, foundRoom);

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
