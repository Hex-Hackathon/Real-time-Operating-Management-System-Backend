require("dotenv").config();
//Express App Initialization
const express = require("express");
const app = express();

//Adding CORS to Express App
const cors = require("cors");
app.use(cors());

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

const { newOrderProcess } = require("./real_time");

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
    let data = {
      customer_id: new ObjectId(customer_id),
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
            deli_status: "pending",
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

app.post("/incoming_pending_orders", async function (req, res) {
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
  const { truck_id, deperature_date, completed_date, IdsOfOrders } = req.body;

  if (!truck_id || !deperature_date || !completed_date || !IdsOfOrders) {
    return res.status(400).json({ msg: "required: something !!!" });
  }

  try {
    let data = {
      truck_id,
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
        { $set: { deli_id: result.insertedId } }
      );
    }

    if (result) return res.status(201).json(result);
    if (!result) throw new Error("Truck Create Fail");
  } catch (e) {
    return res.status(400).json({ msg: e.message });
  }
});

app.get("/deli-routes", async function (req, res) {
  try {
    const result = await deli_route
      .find({ deli_status: "On Going" })
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

app.get("/deli-route-details", async function (req, res) {
  const { route_id } = req.body;

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

app.get("/orders-list-by_month", async function (req, res) {
  const { date } = req.body;

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

app.get("/order-analysis", async (req, res) => {
  const analysisTime = req.query?.analysisTime;
  const analyzedBy = req.query?.analyzedBy;

  if (
    !analysisTime ||
    typeof analysisTime !== "string" ||
    !VALID_TIME[analysisTime]
  ) {
    return res.status(400).json({ message: "Invalid analysis time!" });
  }

  if (
    !analyzedBy ||
    typeof analyzedBy !== "string" ||
    !ANALYSIS_METHOD[analyzedBy]
  ) {
    return res.status(400).json({ message: "Invalid analysis method!" });
  }

  const analysisMethod = ANALYSIS_METHOD[analyzedBy];
  const currentDate = new Date();
  const dateStartMethod = DATE_START_METHOD[analysisTime];

  const analysisDateQuery = {
    $gte: dateStartMethod(currentDate),
    $lte: currentDate,
  };

  const analysis = await orders
    .aggregate([
      {
        $match: {
          created_date: analysisDateQuery,
        },
      },
      {
        $group: {
          _id: "$delivery_status",
          count: { $sum: 1 },
          created_date: {
            $addToSet: "$created_date",
          },
        },
      },
      {
        $project: {
          _id: 0,
          [analysisMethod]: "$_id",
          count: 1,
          created_date: 1,
        },
      },
    ])
    .toArray();

  res.json(analysis);
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

app.listen(8888, () => {
  console.log("API server running at http://localhost:8888");
});
