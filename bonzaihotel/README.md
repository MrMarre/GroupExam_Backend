org:
Jens: schoolwork
Martin: marresshserverless
Christian: serverlessbonzai

Todo:

1. PUT on booking, change room, amount of people, date for checkin and checkout.
2. Double check the delete request. -----DONE
3. Change the get command to scan command. -----DONE
4. Add totalsum that displays to the customer. -----DONE

Nice to have

Search for one booking, display empty rooms.
Split the lambda functions in to separate functions. (dont forget the yml changes)

---

POST layout bookings/

{
"bookings": [
{
"roomId": "51cd5b36-be59-4f87-b4e1-1c0d4e4747c4",
"epost": "hej@hej",
"checkIn": "2024-09-22",
"checkOut": "2024-09-25",
"clientName": "John Doe",
"guests": 1
},
]
}

---

PUT layout /bookings/:bookingId

{
"roomId": "636aab42-2fb2-4372-bb73-f4ebc7fb9685",
"newRoomId": "51cd5b36-be59-4f87-b4e1-1c0d4e4747c4",
"guests": 1,
"checkIn": "2023-09-20",
"checkOut": "2023-10-12"
}

Add new room to bookingId

{
"roomId": "xxxx xxxx xxxx xxxx",
"guests": 1,
"checkIn": "2023-09-20",
"checkOut": "2023-10-12"
}

---

DELETE ROOM bookings/rooms/:roomId
(If there is no room left in the booking, this will delete the order aswell)

DELETE ORDER bookings/:bookingId
