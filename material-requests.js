const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

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
const material_requests = flavorflow_db.collection("material_requests");

app.get("/raw-materials", async (req, res) => {
	const result = await raw_materials.find().toArray();
	return res.json(result);
});

app.post("/requested-materials", async (req, res) => {
	const material_name = req.body?.material_name;
	const quantity = req.body?.quantity;
	const budget = req.body?.budget;

	if (!material_name || !quantity || !budget) {
		return res.status(400).json({
			message: "Material ID, budget and quantity are required!",
		});
	}

	const foundMaterial = await raw_materials.findOne({
		raw_material_name: material_name,
	});
	if (!foundMaterial) {
		return res.status(400).json({ message: "No raw material found!" });
	}

	// valid status : 'pending' | 'approved'
	const newRequest = await material_requests.insertOne({
		material_id: foundMaterial._id,
		quantity,
		budget,
		status: "pending",
		created_date: new Date(),
	});
	return res.json(newRequest);
});

app.get("/requested-materials/:date", async (req, res) => {
	const inputDateString = req.params?.date;
	if (!inputDateString) {
		return res.status(400).json({ message: "Date is required!" });
	}

	const currentDate = new Date();
	const inputDate = new Date(inputDateString);

	const startDayDate = new Date(inputDate.toISOString());
	startDayDate.setHours(0, 0, 0, 0);

	const sameYear = inputDate.getFullYear() === currentDate.getFullYear();
	const sameMonth = inputDate.getMonth() === currentDate.getMonth();
	const sameDay = inputDate.getDate() === currentDate.getDate();

	if (!sameYear || !sameMonth || !sameDay) {
		inputDate.setHours(23, 59, 59, 999);
	} else {
		inputDate.setHours(
			currentDate.getHours(),
			currentDate.getMinutes(),
			currentDate.getSeconds(),
			currentDate.getMilliseconds()
		);
	}

	const data = await material_requests
		.aggregate([
			{
				$match: {
					created_date: {
						$gte: startDayDate,
						$lte: inputDate,
					},
				},
			},
			{
				$lookup: {
					from: "raw_materials",
					localField: "material_id",
					foreignField: "_id",
					as: "material",
				},
			},
			{
				$unwind: {
					path: "$material",
					includeArrayIndex: "material_index",
					preserveNullAndEmptyArrays: true,
				},
			},
			{
				$project: {
					material_index: 0,
					material_id: 0,
					"material.in_stock_count": 0,
				},
			},
		])
		.toArray();

	return res.json(data);
});

app.patch("/approve-material-requests", async (req, res) => {
	try {
		const request_ids = req.body?.request_ids;

		if (!request_ids || !request_ids.length) {
			return res
				.status(400)
				.json({ message: "Request id list is required!" });
		}

		const requestObjectIds = request_ids.map((idString) => {
			if (!ObjectId.isValid(idString)) {
				throw new Error("Invalid request ID!");
			}
			return new ObjectId(idString);
		});

		const foundRequests = await material_requests
			.find({
				_id: {
					$in: requestObjectIds,
				},
			})
			.toArray();
		if (!foundRequests) {
			return res.status(400).json({ message: "No requests found!" });
		}

		const result = await material_requests.updateMany(
			{
				_id: {
					$in: foundRequests.map((request) => request._id),
				},
			},
			{
				$set: {
					status: "approved",
				},
			}
		);

		return res.json(result);
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
});

app.post("/add-stock", async (req, res) => {
	const product_name = req.body?.product_name;
	const quantity = req.body?.quantity;

	if (
		!product_name ||
		typeof product_name !== "string" ||
		!quantity ||
		typeof quantity !== "number"
	) {
		return res
			.status(400)
			.json({ message: "Product Name and Quantity are required!" });
	}

	const foundProduct = await products.findOne({ product_name });
	if (!!foundProduct) {
		return res.status(400).json({ message: "Product already exists!" });
	}

	const result = await products.insertOne({
		product_name,
		in_stock_count: quantity,
	});
	if (!result) {
		return res.status(500).json({ message: "Something went wrong!" });
	}
	return res.json(result);
});

app.delete("/remove-stock/:id", async (req, res) => {
	const productId = req.params?.id;
	if (!productId) {
		return res.status(400).json({ message: "Product ID is required!" });
	}
	if (!ObjectId.isValid(productId)) {
		return res.status(400).json({ message: "Invalid product ID!" });
	}

	const result = await products.findOneAndDelete({
		_id: new ObjectId(productId),
	});
	if(!result) {
		return res.status(400).json({message: 'Product not found!'})
	}
	return res.json({message: 'Product deleted successfully!'});
});

app.listen(3500, () => {
	console.log("server started!");
});
