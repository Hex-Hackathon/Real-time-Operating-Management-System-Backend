const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors({ origin: "*" }));

const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const client = new MongoClient("mongodb://localhost:27017/", {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
});

//Getting collection from Database
const flavorflow_db = client.db("testjslkjfd;klj");
const customers = flavorflow_db.collection("customers");
const employee = flavorflow_db.collection("employee");
const orders = flavorflow_db.collection("orders");
const products = flavorflow_db.collection("products");
const Order_Product_Details = flavorflow_db.collection("Order_Product_Details");

const truck = flavorflow_db.collection("truck");
const deli_route = flavorflow_db.collection("deli_routes");

const raw_materials = flavorflow_db.collection("raw_materials");
const receipe = flavorflow_db.collection("receipe");

const required_materials = flavorflow_db.collection("required_materials");

app.get("/admin-overall-data", async (req, res) => {
	const date = req.query?.date;
	if (!date) {
		return res.status(400).json({ message: "Date is required!" });
	}
	const currentDate = new Date();
	const inputDate = new Date(date);

	const startMonthDate = new Date(
		inputDate.getFullYear(),
		inputDate.getMonth()
	);
	startMonthDate.setDate(1);
	startMonthDate.setHours(0, 0, 0, 0);

	const sameYear = inputDate.getFullYear() === currentDate.getFullYear();
	const sameMonth = inputDate.getMonth() === currentDate.getMonth();
	const sameDay = inputDate.getDate() === currentDate.getDate();

	if (!sameYear || !sameMonth || !sameDay) {
		inputDate.setMonth(inputDate.getMonth() + 1, 0);
		inputDate.setHours(23, 59, 59, 999);
	}

	//* use for debugging
	// console.log({ startMonthDate, inputDate });

	const totalOrders = await orders.countDocuments({
		created_date: {
			$gte: startMonthDate,
			$lte: inputDate,
		},
	});

	const totalDeliveringTrucks = await deli_route.countDocuments({
		created_date: {
			$gte: startMonthDate,
			$lte: inputDate,
		},
	});

	const totalCustomers = await customers.countDocuments({
		created_date: {
			$gte: startMonthDate,
			$lte: inputDate,
		},
	});

	res.json([
		{ name: "orders", count: totalOrders },
		{ name: "deliveringTrucks", count: totalDeliveringTrucks },
		{ name: "customers", count: totalCustomers },
	]);
});

app.listen(3500, () => {
	console.log("server started!");
});
