const admin =require("firebase-admin");
const path=require("path");

admin.initializeApp({
  credential: admin.credential.cert(path.join(__dirname, "firebase_key.json")),
  databaseURL: `https://flavorwave-event-default-rtdb.asia-southeast1.firebasedatabase.app`,
});

const db = admin.database();

async function newOrderProcess() {
  const ref = db.ref(
    "NewOrderEvent"
  );
  return await ref.set(new Date());

 // return await newRef.set({ message: "hello world" });
}

module.exports = { newOrderProcess };