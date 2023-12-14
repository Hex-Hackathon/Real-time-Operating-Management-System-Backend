require("dotenv").config();
//Express App Initialization
const express = require("express");
const app = express();

//Adding CORS to Express App
const cors = require("cors");
app.use(cors({ origin: "*" }));
const bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

//for encrypting data
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

//MongoDB Connection
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const client = new MongoClient(
  process.env.MONGO_URL || "mongodb://127.0.0.1:27017",
  {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  }
);

//Getting collection from Database
const flavorflow_db = client.db("FlavorFlow");
const customers = flavorflow_db.collection("customers");
const employee = flavorflow_db.collection("employee");
const orders = flavorflow_db.collection("orders");
const products = flavorflow_db.collection("products");
const Order_Product_Details = flavorflow_db.collection("Order_Product_Details");

const truck = flavorflow_db.collection("truck");
const deli_route = flavorflow_db.collection("deli_route");
const material_requests = flavorflow_db.collection("material_requests");
const stock_requests = flavorflow_db.collection("stock_requests");
const raw_materials = flavorflow_db.collection("raw_materials");
const receipe = flavorflow_db.collection("receipe");

const required_materials = flavorflow_db.collection("required_materials");

//JWT KEYS
const secret_sales = process.env.SALES_JWT;
const secret_logistics = process.env.LOGISTICS_JWT;
const secret_warehouse = process.env.WAREHOUSE_JWT;
const secret_admin = process.env.ADMIN_JWT;
const secret_factory = process.env.FACTORY_JWT;

// real-time

const {
  newOrderProcess,
  newDeliRouteProcess,
  newRawRequestProcess,
} = require("./real_time");

//--------------- --------------- ----- --------------- ---------------
//--------------- --------------- SALES --------------- ---------------
//--------------- --------------- ----- --------------- ---------------

app.get("/", async function (req, res) {
  try {
    return res.status(200).json({ msg: "Welcome to FlavorWave API!!!" });
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

const sales_auth = function (req, res, next) {
  const { authorization } = req.headers;
  const token = authorization && authorization.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Token required" });
  }

  try {
    let user = jwt.verify(token, secret_sales);
    res.locals.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
};

app.post("/sales-login", async function (req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ msg: "required: name or email or password !!!" });
  }

  try {
    const user = await employee.findOne({ email });
    console.log(user);

    if (user && user.department == "Sales") {
      const result = await bcrypt.compare(password, user.password);

      if (result) {
        const token = jwt.sign(user, secret_sales, {
          expiresIn: Math.floor(Date.now() / 1000) + 60 * 60 * 9,
        });
        delete user.password;
        return res.status(201).json({ token, user });
      }
    }

    return res
      .status(403)
      .json({ msg: "Incorrect name or email or password !!!" });
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/orders", async function (req, res) {
  const { customer_id, expected_date } = req.body;

  if (!customer_id || !expected_date) {
    res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    const ifcustomer = await customers.findOne({
      _id: new ObjectId(customer_id),
    });
    console.log(ifcustomer);
    if (ifcustomer) {
      let data = {
        customer_id: new ObjectId(ifcustomer._id),
        product_list: [],
        order_status: "pending",
        delivery_status: "pending",
        paid: "no",
        created_date: new Date(),
        expected_date: new Date(expected_date),
        deli_id: "",
      };

      const result = await orders.insertOne(data);

      if (result.insertedId) return res.status(201).json(result);
    } else {
      return res.status(400).json({ msg: "No Customer Create Customer First" });
    }
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

//Important route
app.post("/add_products_to_order", async function (req, res) {
  const { order_id, product_id, product_count } = req.body;

  if (!order_id || !product_id || !product_count) {
    res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    const document = await products.findOne({ _id: new ObjectId(product_id) });
    if (document.in_stock_count <= product_count) {
      res.status(400).json({
        msg: `Not Enough Stock to fullfill ${product_count} of product !!!`,
      });
    } else {
      let data = {
        order_id: new ObjectId(order_id),
        product_id: new ObjectId(product_id),
        count: Number(product_count),
      };

      const result1 = await Order_Product_Details.insertOne(data);

      let result2;

      if (result1.insertedId) {
        result2 = await orders.updateOne(
          { _id: new ObjectId(order_id) },
          {
            $addToSet: { product_list: result1.insertedId },
          }
        );
      }

      await products.findOneAndUpdate(
        { _id: new ObjectId(product_id) },
        {
          $inc: {
            in_stock_count: -product_count,
          },
        }
      );

      if (result2) return res.status(201).json({ msg: "Data Updated" });
    }
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.post("/order_process_confirm", async function (req, res) {
  const { order_id } = req.body;

  if (!order_id) {
    res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    const result = await orders.findOneAndUpdate(
      { _id: new ObjectId(order_id) },
      {
        $set: {
          order_status: "processing",
          delivery_status: "processing",
        },
      }
    );
    if (result) {
      newOrderProcess();
      return res.status(201).json({ msg: "Process Updated" });
    }
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/pending_orders_list", async function (req, res) {
  try {
    const result = await orders
      .aggregate([
        {
          $match: {
            order_status: "pending",
            delivery_status: "pending",
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer_id",
            foreignField: "_id",
            as: "customer",
          },
        },
        {
          $unwind: "$customer",
        },
        {
          $addFields: {
            customer_name: "$customer.name",
            delivery: "$customer.deli_address",
          },
        },
        {
          $project: {
            customer: 0,
          },
        },
      ])
      .sort({ created_date: -1 })
      .toArray();

    if (result == []) return res.status(400).json({ msg: "No Data Something" });
    if (result) return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/processing_orders_list", async function (req, res) {
  try {
    const result = await orders
      .aggregate([
        {
          $match: {
            order_status: "processing",
            delivery_status: "processing",
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer_id",
            foreignField: "_id",
            as: "customer",
          },
        },
        {
          $unwind: "$customer",
        },
        {
          $addFields: {
            customer_name: "$customer.name",
            delivery: "$customer.deli_address",
          },
        },
        {
          $project: {
            customer: 0,
          },
        },
      ])
      .sort({ created_date: -1 })
      .toArray();

    if (result == []) return res.status(400).json({ msg: "No Data Something" });
    if (result) return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/orders_list_by_place_order_day/:date", async function (req, res) {
  const { date } = req.params;

  if (!date) {
    res.status(400).json({ msg: "required: something !!!" });
  }

  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  try {
    const result = await orders
      .aggregate([
        {
          $match: {
            created_date: { $gte: startOfDay, $lt: endOfDay },
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer_id",
            foreignField: "_id",
            as: "customer",
          },
        },
        {
          $unwind: "$customer",
        },
        {
          $addFields: {
            customer_name: "$customer.name",
            delivery: "$customer.delivery_address",
          },
        },
        {
          $project: {
            customer: 0,
          },
        },
      ])
      .toArray();

    if (result == []) return res.status(201).json({ msg: "No Data That Day" });
    if (result) return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/orders_list_by_deli_day/:date", async function (req, res) {
  const { date } = req.params;

  if (!date) {
    res.status(400).json({ msg: "required: something !!!" });
  }

  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  try {
    const result = await orders
      .aggregate([
        {
          $match: {
            expected_date: { $gte: startOfDay, $lt: endOfDay },
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer_id",
            foreignField: "_id",
            as: "customer",
          },
        },
        {
          $unwind: "$customer",
        },
        {
          $addFields: {
            customer_name: "$customer.name",
            delivery: "$customer.delivery_address",
          },
        },
        {
          $project: {
            customer: 0,
          },
        },
      ])
      .toArray();

    if (result == []) return res.status(201).json({ msg: "No Data That Day" });
    if (result) return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

// app.get("/orders_list_between_days", async function (req, res) {});

// app.get("/orders_list_by_month", async function (req, res) {});

app.get("/order_details/:order_id", async function (req, res) {
  const { order_id } = req.params;

  if (!order_id) {
    res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    const order = await orders.findOne({
      _id: new ObjectId(order_id),
    });

    if (order) {
      // const productIds = order.product_list.map((productId) => ({
      //   _id: productId,
      // }));

      //   const products = await Order_Product_Details
      //     .find({ $or: productIds })
      //     .toArray();

      const products = await Order_Product_Details.aggregate([
        {
          $match: {
            order_id: new ObjectId(order_id),
            //   _id: { $in: productIds },
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "product_id",
            foreignField: "_id",
            as: "product",
          },
        },
        {
          $unwind: "$product",
        },
        {
          $addFields: {
            product_name: "$product.product_name",
          },
        },
        {
          $project: {
            product: 0,
          },
        },
      ]).toArray();

      console.log("Order Details:", order);
      console.log("Products:", products);

      if (order && products) return res.status(201).json([order, products]);
    } else {
      console.log("Order not found.");
    }
  } catch (error) {
    console.error("Error retrieving data:", error);
  }
});

app.post("/create_customer", async function (req, res) {
  const { name, phone, deli_address, role } = req.body;

  if (!name || !phone || !deli_address || !role) {
    res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    let data = {
      name,
      phone,
      deli_address,
      role,
      created_date: new Date(),
      updated_date: new Date(),
    };

    const result = await customers.insertOne(data);

    if (result) return res.status(201).json(result);
    if (!result) throw new Error("Customer Create Fail");
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/search_a_customer", async function (req, res) {
  const { name, phone, deli_address, role } = req.query;

  if (!name && !phone && !deli_address && !role) {
    return res
      .status(400)
      .json({ message: "At least one input data must be provided." });
  }

  try {
    // Constructing the query object dynamically based on the presence of input data
    let query = {};

    if (name) query.name = new RegExp(name, "i"); // Case-insensitive search using regular expression
    if (phone) query.phone = phone;
    if (deli_address) query.deli_address = new RegExp(deli_address, "i");
    if (role) query.role = role;

    // Finding the customer based on the constructed query
    if (query == {}) throw new Error("Need at least one input data");
    const result = await customers.find(query).toArray();

    if (result) return res.status(201).json(result);
    if (!result) throw new Error("There is no such user");
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/customer_lists", async function (req, res) {
  try {
    const result = await customers
      .find({})
      .sort({ created_date: -1 })
      .limit(50)
      .toArray();
    if (result) return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/search-customer", async function (req, res) {
  const { query } = req.query;
  try {
    const result = await customers
      .find({
        $or: [
          { name: { $regex: new RegExp(query, "i") } }, // Case-insensitive search for name
          { phone: { $regex: new RegExp(query, "i") } }, // Case-insensitive search for phone
        ],
      })
      .toArray();

    if (result) return res.status(200).json(result);
    if (!result) return res.status(400).json({ msg: "No Such Customer" });
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/customer_lists_conditionals", async function (req, res) {
  const { name, phone, deli_address, role } = req.query;

  if (!name && !phone && !deli_address && !role) {
    return res
      .status(400)
      .json({ message: "At least one input data must be provided." });
  }

  try {
    // Constructing the query object dynamically based on the presence of input data
    let query = {};

    if (name) query.name = new RegExp(name, "i"); // Case-insensitive search using regular expression
    if (phone) query.phone = phone;
    if (deli_address) query.deli_address = new RegExp(deli_address, "i");
    if (role) query.role = role;

    // Finding the customer based on the constructed query
    if (query == {}) throw new Error("Need at least one input data");
    const result = await customers
      .find(query)
      .sort({ created_date: -1 })
      .limit(50)
      .toArray();

    if (result) return res.status(201).json(result);
    if (!result) throw new Error("There is no such user");
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.get("/instock-lists", async function (req, res) {
  try {
    const result = await products
      .find({})
      .sort({
        in_stock_count: 1,
      })
      .limit(50)
      .toArray();
    if (result) return res.status(201).json(result);
    if (!result) throw new Error("Something Wrong Try Again");
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.get("/requested-stocks-sales/:date", async (req, res) => {
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

  const data = await stock_requests
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
          from: "products",
          localField: "product_id",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: {
          path: "$product",
          includeArrayIndex: "index",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          index: 0,
          product_id: 0,
        },
      },
    ])
    .toArray();
  return res.json(data);
});

//--------------- --------------- --------- --------------- ---------------
//--------------- --------------- Logistics --------------- ---------------
//--------------- --------------- --------- --------------- ---------------
const logistics_auth = function (req, res, next) {
  const { authorization } = req.headers;
  const token = authorization && authorization.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Token required" });
  }

  try {
    let user = jwt.verify(token, secret_logistics);
    res.locals.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
};

app.post("/logistics-login", async function (req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ msg: "required: name or email or password !!!" });
  }

  try {
    const user = await employee.findOne({ email });
    console.log(user);

    if (user && user.department == "Logistics") {
      const result = await bcrypt.compare(password, user.password);

      if (result) {
        const token = jwt.sign(user, secret_logistics, {
          expiresIn: Math.floor(Date.now() / 1000) + 60 * 60 * 9,
        });
        delete user.password;
        return res.status(201).json({ token, user });
      }
    }

    return res
      .status(403)
      .json({ msg: "Incorrect name or email or password !!!" });
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/create-truck", async function (req, res) {
  const { truck_id_card, truck_capacity, driver } = req.body;

  if (!truck_id_card || !truck_capacity || !driver) {
    return res
      .status(400)
      .json({ msg: "required: name or email or password !!!" });
  }

  try {
    let data = {
      truck_id_card,
      truck_capacity: Number(truck_capacity),
      driver,
      created_date: new Date(),
      updated_date: new Date(),
    };

    const result = await truck.insertOne(data);

    if (result) return res.status(201).json(result);
    if (!result) throw new Error("Truck Create Fail");
  } catch (e) {
    return res.status(400).json({ msg: e.message });
  }
});

app.get("/truck-lists", async function (req, res) {
  try {
    const result = await truck
      .find({})
      .sort({ truck_capacity: -1 })
      .limit(50)
      .toArray();
    if (result) return res.status(201).json(result);
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.get("/incoming_pending_orders", async function (req, res) {
  try {
    const result = await orders
      .aggregate([
        {
          $match: {
            order_status: "pending",
            delivery_status: "pending",
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer_id",
            foreignField: "_id",
            as: "customer",
          },
        },
        {
          $unwind: "$customer",
        },
        {
          $addFields: {
            customer_name: "$customer.name",
            delivery: "$customer.delivery_address",
          },
        },
        {
          $project: {
            customer: 0,
          },
        },
      ])
      .toArray();

    if (result == []) return res.status(201).json({ msg: "No Data That Day" });
    if (result) return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

app.post("/create-deli-route", async function (req, res) {
  const { truck_id_card, deperature_date, completed_date, IdsOfOrders } =
    req.body;

  if (!truck_id_card || !deperature_date || !completed_date || !IdsOfOrders) {
    return res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    const iftruck = await truck.findOne({ truck_id_card });

    if (iftruck) {
      let data = {
        truck_id: new ObjectId(iftruck._id),
        deperature_date: new Date(deperature_date),
        completed_date: new Date(completed_date),
        IdsOfOrders: IdsOfOrders,
        deli_status: "On Going",
        created_date: new Date(),
      };

      const result = await deli_route.insertOne(data);

      if (result.insertedId) {
        // const orderIds = IdsOfOrders.map((orderId) => ({
        //   _id: orderId,
        // }));

        // console.log(orderIds);

        const objectIds = IdsOfOrders.map((doc) => new ObjectId(doc));
        // Update the specific document using its ID
        await orders.updateMany(
          { _id: { $in: objectIds } },
          {
            $set: { deli_id: result.insertedId, delivery_status: "delivering" },
          }
        );

        newDeliRouteProcess();
      }

      if (result) return res.status(201).json(result);
      if (!result) throw new Error("Truck Create Fail");
    }
    if (!result) throw new Error("No Truck with such name");
  } catch (e) {
    return res.status(400).json({ msg: e.message });
  }
});

app.get("/deli-routes", async function (req, res) {
  try {
    const result = await deli_route
      .find({ })
      .sort({
        deperature_date: -1,
      })
      .limit(50)
      .toArray();
    if (result) return res.status(201).json(result);
  } catch (e) {
    return res.status(400).json({ msg: e.message });
  }
});

app.get("/deli-route-details/:route_id", async function (req, res) {
  const { route_id } = req.params;

  if (!route_id) {
    return res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    const mainDocument = await deli_route.findOne({
      _id: new ObjectId(route_id),
    });

    if (!mainDocument) {
      console.log("Main document not found.");
      return;
    }

    // Extract order IDs from the main document
    const orderIdsArray = mainDocument.IdsOfOrders.map(
      (id) => new ObjectId(id)
    );

    // Find orders using the order IDs
    const orderRe = await orders
      .find({ _id: { $in: orderIdsArray } })
      .toArray();

    console.log("Main document:", mainDocument);
    console.log("Orders:", orderRe);

    if ((mainDocument, orderRe))
      return res.status(201).json([mainDocument, orderRe]);
    if (!mainDocument || !orderRe) throw new Error("Truck Create Fail");
  } catch (e) {
    return res.status(400).json({ msg: e.message });
  }
});

//--------------- --------------- --------- --------------- ---------------
//--------------- --------------- Warehouse --------------- ---------------
//--------------- --------------- --------- --------------- ---------------
const warehouse_auth = function (req, res, next) {
  const { authorization } = req.headers;
  const token = authorization && authorization.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Token required" });
  }

  try {
    let user = jwt.verify(token, secret_warehouse);
    res.locals.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
};

app.post("/warehouse-login", async function (req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ msg: "required: name or email or password !!!" });
  }

  try {
    const user = await employee.findOne({ email });
    console.log(user);

    if (user && user.department == "Warehouse") {
      const result = await bcrypt.compare(password, user.password);

      if (result) {
        const token = jwt.sign(user, secret_warehouse, {
          expiresIn: Math.floor(Date.now() / 1000) + 60 * 60 * 9,
        });
        delete user.password;
        return res.status(201).json({ token, user });
      }
    }

    return res
      .status(403)
      .json({ msg: "Incorrect name or email or password !!!" });
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/product-increase", async function (req, res) {
  const { product_id, increase } = req.body;

  if (!product_id || !increase) {
    return res.status(400).json({ msg: "required: product_id or number !!!" });
  }

  const incre = Number(increase);

  if (typeof incre !== "number") {
    return res.status(400).json({
      message: "Increment value must be provided and must be a number.",
    });
  }

  try {
    const updateddata = await products.findOneAndUpdate(
      { _id: new ObjectId(product_id) },
      {
        $inc: {
          in_stock_count: incre,
        },
      }
    );

    if (updateddata) return res.status(201).json({ msg: "Increase Complete" });
    if (!updateddata) throw new Error("Something Wrong Try Again");
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/product-decrease", async function (req, res) {
  const { product_id, decrease } = req.body;

  if (!product_id || !decrease) {
    return res.status(400).json({
      msg: "required: product_id or number !!!",
    });
  }

  const decre = Number(decrease);

  if (typeof decre !== "number") {
    return res.status(400).json({
      message: "Decrement value must be provided and must be a number.",
    });
  }

  try {
    const updateddata = await products.findOneAndUpdate(
      { _id: new ObjectId(product_id) },
      {
        $inc: {
          in_stock_count: -decre,
        },
      }
    );

    if (updateddata) return res.status(201).json({ msg: "Decrease Complete" });
    if (!updateddata) throw new Error("Something Wrong Try Again");
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.get("/product-lists", async function (req, res) {
  try {
    const result = await products
      .find({})
      .sort({
        in_stock_count: 1,
      })
      .limit(50)
      .toArray();
    if (result) return res.status(201).json(result);
    if (!result) throw new Error("Something Wrong Try Again");
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.get("/requested-stocks-warehouse/:date", async (req, res) => {
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

  const data = await stock_requests
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
          from: "products",
          localField: "product_id",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: {
          path: "$product",
          includeArrayIndex: "index",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          index: 0,
          product_id: 0,
        },
      },
    ])
    .toArray();
  return res.json(data);
});

app.post("/request-stock", async (req, res) => {
  const product_id = req.body?.product_id;
  const quantity = req.body?.quantity;

  if (
    !product_id ||
    // typeof product_id !== "string" ||
    !quantity
    // typeof quantity !== "number"
  ) {
    return res
      .status(400)
      .json({ message: "Product ID and Quantity are required!" });
  }
  // if (!ObjectId.isValid(product_id)) {
  //   return res.status(400).json({ message: "Invalid product ID!" });
  // }

  // create new product if doesn't exist
  const foundProduct = await products.findOne({
    _id: new ObjectId(product_id),
  });
  if (!foundProduct) {
    return res.status(400).json({ message: "No product found!" });
  }

  // status - 'processing' | 'done'
  //  admin_status - 'processing' | 'approved'
  const data = await stock_requests.insertOne({
    product_id: foundProduct?._id,
    quantity: Number(quantity),
    status: "processing",
    admin_status: "processing",
    created_date: new Date(),
  });
  if (data.insertedId) {
    newRawRequestProcess();
    return res.status(201).json(data);
  }
  if (!data) {
    return res.status(500).json({ message: "Something went wrong!" });
  }
  //return res.json(data);
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
  if (!result) {
    return res.status(400).json({ message: "Product not found!" });
  }
  return res.json({ message: "Product deleted successfully!" });
});

app.get("/requested-stocks/:date", async (req, res) => {
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

  const data = await stock_requests
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
          from: "products",
          localField: "product_id",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: {
          path: "$product",
          includeArrayIndex: "index",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          index: 0,
          product_id: 0,
        },
      },
    ])
    .toArray();
  return res.json(data);
});
//--------------- --------------- ----- --------------- ---------------
//--------------- --------------- Admin --------------- ---------------
//--------------- --------------- ----- --------------- ---------------
const admin_auth = function (req, res, next) {
  const { authorization } = req.headers;
  const token = authorization && authorization.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Token required" });
  }

  try {
    let user = jwt.verify(token, secret_admin);
    res.locals.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
};

app.post("/admin-login", async function (req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ msg: "required: name or email or password !!!" });
  }

  try {
    const user = await employee.findOne({ email });
    console.log(user);

    if (user && user.department == "Adminstration") {
      const result = await bcrypt.compare(password, user.password);

      if (result) {
        const token = jwt.sign(user, secret_admin, {
          expiresIn: Math.floor(Date.now() / 1000) + 60 * 60 * 9,
        });
        delete user.password;
        return res.status(201).json({ token, user });
      }
    }

    return res
      .status(403)
      .json({ msg: "Incorrect name or email or password !!!" });
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/create-employee", async function (req, res) {
  const { name, email, phone, role, department, password } = req.body;

  try {
    //checking the data
    if (!name || !email || !phone || !role || !department || !password) {
      return res.status(400).json({ msg: "required: something !!!" });
    }

    //hashing the password
    let hashed_password = await bcrypt.hash(password, 10);

    const employee_data = {
      name,
      email,
      role,
      created_at: new Date(),
      updated_at: new Date(),
      department,
      password: hashed_password,
    };

    const result = await employee.insertOne(employee_data);

    if (result.insertedId) return res.status(201).json(result);
    if (!result.insertedId) throw new Error("Something Wrong Try Again");
  } catch (error) {
    return res.status(201).json({ msg: error.message });
  }
});

app.get("/employee-list/:start/:end", async function (req, res) {
  const { start, end } = req.params;

  try {
    //checking the data
    if (!start || !end) {
      return res.status(400).json({ msg: "required: something !!!" });
    }

    const pageSize = parseInt(end) - parseInt(start) + 1;

    // Sorting in descending order to get the latest employees first
    const employees = await employee
      .find()
      .sort({
        created_at: -1,
      }) // assuming you have a field named 'hireDate'
      .skip((parseInt(start) - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    if (employees) return res.status(201).json(employees);
  } catch (error) {
    return res.status(201).json({ msg: error.message });
  }
});

app.post("/create-admin", async function (req, res) {
  const { name, email, phone, role, department, password } = req.body;

  try {
    //checking the data
    if (!name || !email || !phone || !role || !department || !password) {
      return res.status(400).json({ msg: "required: something !!!" });
    }

    //hashing the password
    let hashed_password = await bcrypt.hash(password, 10);

    const employee_data = {
      name,
      email,
      role,
      created_at: new Date(),
      updated_at: new Date(),
      department,
      password: hashed_password,
    };

    const result = await employee.insertOne(employee_data);

    if (result.insertedId) return res.status(201).json(result);
    if (!result.insertedId) throw new Error("Something Wrong Try Again");
  } catch (error) {
    return res.status(201).json({ msg: error.message });
  }
});

app.post("/create-product", async function (req, res) {
  const { product_name, in_stock_count } = req.body;

  if (!product_name || !in_stock_count) {
    return res
      .status(400)
      .json({ msg: "required: name or email or password !!!" });
  }

  try {
    const product_data = {
      product_name,
      in_stock_count: Number(in_stock_count) || 0,
    };

    const result = await products.insertOne(product_data);

    if (result.insertedId) return res.status(201).json(result);
    if (!result.insertedId) throw new Error("Something Wrong Try Again");
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/create-raw-materials", async function (req, res) {
  const { raw_material_name, in_stock_count } = req.body;

  if (!raw_material_name || !in_stock_count) {
    return res
      .status(400)
      .json({ msg: "required: name or email or password !!!" });
  }

  try {
    const raw_material_data = {
      raw_material_name,
      in_stock_count: Number(in_stock_count) || 0,
    };

    const result = await raw_materials.insertOne(raw_material_data);

    if (result.insertedId) return res.status(201).json(result);
    if (!result.insertedId) throw new Error("Something Wrong Try Again");
  } catch (e) {
    console.log(e.message);
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/create-receipe-of-product", async function (req, res) {
  const { product_id } = req.body;

  if (!product_id) {
    return res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    let data = {
      product_id: new ObjectId(product_id),
      required_raw_materials: [],
    };
    const result = await receipe.insertOne(data);
    if (result.insertedId) return res.status(201).json(result);
    if (!result.insertedId) throw new Error("Something Wrong Try Again");
  } catch (error) {
    console.log(e.message);
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/add-raw-material-to-receipe", async function (req, res) {
  const { receipe_id, raw_material_id, require_raw } = req.body;

  if (!receipe_id) {
    return res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    let data = {
      receipe_id: new ObjectId(receipe_id),
      raw_material_id: new ObjectId(raw_material_id),
      require_raw: Number(require_raw),
    };

    const result = await required_materials.insertOne(data);

    if (result) {
      await receipe.updateOne(
        { _id: new ObjectId(receipe_id) },
        {
          $addToSet: {
            required_raw_materials: new ObjectId(result.insertedId),
          },
        }
      );
    }

    if (result) return res.status(201).json(result);
    if (!result) throw new Error("Something Wrong Try Again");
  } catch (error) {
    console.log(e.message);
    return res.status(500).json({ msg: e.message });
  }
});

app.get("/list-raw-materials", async function (req, res) {
  try {
    const result = await raw_materials
      .find({})
      .sort({ in_stock_count: 1 })
      .toArray();
    if (result) return res.status(200).json(result);
    if (!result) throw new Error("Something Wrong Try Again");
  } catch (error) {
    console.log(e.message);
    return res.status(500).json({ msg: e.message });
  }
});

app.get("/raw-materials", async (req, res) => {
  const result = await raw_materials.find().toArray();
  return res.json(result);
});

app.get("/orders-list-by_month", async function (req, res) {
  const { date } = req.query;

  if (!date) {
    res.status(400).json({ msg: "required: something !!!" });
  }
  //Start of month
  const startOfMonth = new Date(date);
  startOfMonth.setDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  // End of the month
  const endOfMonth = new Date(date);
  endOfMonth.setMonth(endOfMonth.getMonth() + 1); // Move to the next month
  endOfMonth.setDate(0); // Set to the last day of the current month
  endOfMonth.setUTCHours(23, 59, 59, 999);
  try {
    const result = await orders
      .aggregate([
        {
          $match: {
            created_date: { $gte: startOfMonth, $lt: endOfMonth },
          },
        },
        {
          $lookup: {
            from: "customers",
            localField: "customer_id",
            foreignField: "_id",
            as: "customer",
          },
        },
        {
          $unwind: "$customer",
        },
        {
          $addFields: {
            customer_name: "$customer.name",
            delivery: "$customer.delivery_address",
          },
        },
        {
          $project: {
            customer: 0,
          },
        },
      ])
      .toArray();

    if (result == [])
      return res.status(201).json({ msg: "No Data That Day of The Month" });
    if (result) return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ msg: error.message });
  }
});

const VALID_TIME = {
  day: true,
  week: true,
  month: true,
  year: true,
};
const DATE_START_METHOD = {
  day: getDayStart,
  week: getWeekStart,
  month: getMonthStart,
  year: getYearStart,
};

// get the current day with 0 hour, 0 minutes, 0 seconds
function getDayStart(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  );
}

// get the date for first day of the current week (which is sunday) with 0 hour, 0 minutes, 0 seconds
function getWeekStart(date) {
  const startDate = new Date(date);
  startDate.setDate(date.getDate() - date.getDay());

  return startDate;
}

// get the date for first day of the current month (which is 1) with 0 hour, 0 minutes, 0 seconds
function getMonthStart(date) {
  const january = new Date(date.getFullYear(), date.getMonth(), 1);
  january.setHours(0, 0, 0, 0);
  return january;
}

// get the date for first day of the first month of the current year with 0 hour, 0 minutes, 0 seconds
function getYearStart(date) {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}
const ANALYSIS_METHOD = {
  delivery_status: "delivery_status",
  order_status: "order_status",
};

// app.get("/order-analysis", async (req, res) => {
//   const analysisTime = req.query?.analysisTime;
//   const analyzedBy = req.query?.analyzedBy;

//   if (
//     !analysisTime ||
//     typeof analysisTime !== "string" ||
//     !VALID_TIME[analysisTime]
//   ) {
//     return res.status(400).json({ message: "Invalid analysis time!" });
//   }

//   if (
//     !analyzedBy ||
//     typeof analyzedBy !== "string" ||
//     !ANALYSIS_METHOD[analyzedBy]
//   ) {
//     return res.status(400).json({ message: "Invalid analysis method!" });
//   }

//   const analysisMethod = ANALYSIS_METHOD[analyzedBy];
//   const currentDate = new Date();
//   const dateStartMethod = DATE_START_METHOD[analysisTime];

//   const analysisDateQuery = {
//     $gte: dateStartMethod(currentDate),
//     $lte: currentDate,
//   };

//   const analysis = await orders
//     .aggregate([
//       {
//         $match: {
//           created_date: analysisDateQuery,
//         },
//       },
//       {
//         $group: {
//           _id: "$delivery_status",
//           count: { $sum: 1 },
//           created_date: {
//             $addToSet: "$created_date",
//           },
//         },
//       },
//       {
//         $project: {
//           _id: 0,
//           [analysisMethod]: "$_id",
//           count: 1,
//           created_date: 1,
//         },
//       },
//     ])
//     .toArray();

//   res.json(analysis);
// });

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

app.get("/order-analysis", async (req, res) => {
  const period = req.query?.period;
  if (
    !period ||
    (period !== "daily" &&
      period !== "weekly" &&
      period !== "monthly" &&
      period !== "yearly")
  ) {
    return res.status(400).json({ message: "Period is required!" });
  }

  let dateFilter = {};
  if (period === "yearly") {
    dateFilter = {
      $gte: new Date(new Date().getFullYear(), 0, 1, 0, 0, 0, 0),
      $lt: new Date(new Date().getFullYear() + 1, 0, 1),
    };
  } else if (period === "monthly") {
    dateFilter = {
      $gte: new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
        0,
        0,
        0,
        0
      ),
      $lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
    };
  } else if (period === "weekly") {
    const currentDate = new Date();
    const firstDayOfWeek = new Date(
      currentDate.setDate(currentDate.getDate() - currentDate.getDay())
    );
    firstDayOfWeek.setHours(0, 0, 0, 0);

    const lastDayOfWeek = new Date(
      firstDayOfWeek.getFullYear(),
      firstDayOfWeek.getMonth(),
      firstDayOfWeek.getDate() + 7
    );
    console.log({ firstDayOfWeek, lastDayOfWeek });

    dateFilter = {
      $gte: firstDayOfWeek,
      $lt: lastDayOfWeek,
    };
  } else if (period === "daily") {
    dateFilter = {
      $gte: new Date(new Date().setHours(0, 0, 0, 0)),
      $lt: new Date(new Date().setHours(23, 59, 59, 999)),
    };
  }

  const analysis = await orders
    .aggregate([
      {
        $match: {
          created_date: dateFilter,
        },
      },
      {
        $group: {
          _id: "$order_status",
          count: { $sum: 1 },
          created_date: {
            $addToSet: "$created_date",
          },
        },
      },
      {
        $project: {
          _id: 0,
          order_status: "$_id",
          count: 1,
          created_date: 1,
        },
      },
    ])
    .toArray();

  const result = !analysis?.length
    ? []
    : analysis.sort((a, b) => {
        return a.order_status.localeCompare(b);
      });

  res.json(result);
});

app.patch("/approve-stock-request/:id", async (req, res) => {
  const requestId = req.params?.id;
  if (!requestId) {
    return res.status(400).json({ message: "Request ID is required!" });
  }
  if (!ObjectId.isValid(requestId)) {
    return res.status(400).json({ message: "Invalid request ID!" });
  }

  const result = await stock_requests.findOneAndUpdate(
    { _id: new ObjectId(requestId) },
    { $set: { admin_status: "approved" } }
  );
  if (!result) {
    return res.status(400).json({ message: "Request not found!" });
  }
  return res.json({ mesage: "Approved!" });
});
//--------------- --------------- ------- --------------- ---------------
//--------------- --------------- Factory --------------- ---------------
//--------------- --------------- ------- --------------- ---------------
const factory_auth = function (req, res, next) {
  const { authorization } = req.headers;
  const token = authorization && authorization.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Token required" });
  }

  try {
    let user = jwt.verify(token, secret_factory);
    res.locals.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
};

app.get("/raw-materials-list", async function (req, res) {
  try {
    const result = await raw_materials
      .find({})
      .sort({ in_stock_count: 1 })
      .toArray();
    if (result) return res.status(200).json(result);
    if (!result) throw new Error("Something Wrong Try Again");
  } catch (error) {
    console.log(e.message);
    return res.status(500).json({ msg: e.message });
  }
});

app.post("/factory-login", async function (req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ msg: "required: name or email or password !!!" });
  }

  try {
    const user = await employee.findOne({ email });
    console.log(user);

    if (user && user.department == "Factory") {
      const result = await bcrypt.compare(password, user.password);

      if (result) {
        const token = jwt.sign(user, secret_factory, {
          expiresIn: Math.floor(Date.now() / 1000) + 60 * 60 * 9,
        });
        delete user.password;
        return res.status(201).json({ token, user });
      }
    }

    return res
      .status(403)
      .json({ msg: "Incorrect name or email or password !!!" });
  } catch (e) {
    return res.status(500).json({ msg: e.message });
  }
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
      return res.status(400).json({ message: "Request id list is required!" });
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

app.patch("/provide-stock-request/:id", async (req, res) => {
  const requestId = req.params?.id;
  if (!requestId) {
    return res.status(400).json({ message: "Request ID is required!" });
  }
  if (!ObjectId.isValid(requestId)) {
    return res.status(400).json({ message: "Invalid request ID!" });
  }

  const result = await stock_requests.findOneAndUpdate(
    { _id: new ObjectId(requestId) },
    { $set: { status: "processed" } }
  );
  if (!result) {
    return res.status(400).json({ message: "Request not found!" });
  }
  return res.json({ mesage: "Approved!" });
});

app.get("/all", async function (req, res) {
  const d1 = await customers.find({}).toArray();
  const d2 = await employee.find({}).toArray();
  const d3 = await orders.find({}).toArray();
  const d10 = await Order_Product_Details.find({}).toArray();
  const d4 = await deli_route.find({}).toArray();
  const d5 = await products.find({}).toArray();
  const d6 = await raw_materials.find({}).toArray();
  const d7 = await receipe.find({}).toArray();
  const d8 = await required_materials.find({}).toArray();
  const d9 = await truck.find({}).toArray();

  if ((d1, d2, d3, d4, d5, d6, d7, d8, d9)) {
    return res.status(201).json({
      customers: d1,
      employee: d2,
      orders: d3,
      Order_Product_Details: d10,
      deli_route: d4,
      products: d5,
      raw_materials: d6,
      receipe: d7,
      required_materials: d8,
      truck: d9,
    });
  } else {
    return res.status(400).json({ msg: "Somethibg Wrong!!!" });
  }
});

app.listen(8888, () => {
  console.log("API server running at http://localhost:8888");
});
