const express = require("express");
const app = express();
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fe99gj2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString();

const serviceAccount = JSON.parse(decodedKey);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const database = client.db("zap-shift");
    const parcelCollection = database.collection("parcels");
    const paymentCollection = database.collection("payment");
    const userCollection = database.collection("users");
    const riderCollection = database.collection("riders");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });

      if (user?.role !== "admin") {
        return res.status(401).send({ error: true, message: "Forbidden" });
      }

      next();
    };

    const verifyRider = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });

      if (user?.role !== "rider") {
        return res.status(401).send({ error: true, message: "Forbidden" });
      }

      next();
    };

    app.get("/users/:email", async (req, res) => {
      const user = await userCollection.findOne({ email: req.params.email });
      res.send(user);
    });

    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const users = req.body;
      const existing = await userCollection.findOne({ email });
      if (existing) {
        return res
          .status(409)
          .json({ message: "User already exists", inserted: false });
      }
      const result = await userCollection.insertOne(users);
      res.send(result);
    });

    app.get("/parcels", verifyFirebaseToken, async (req, res) => {
      const userEmail = req.query.email;
      // console.log(req.decoded);
      if (userEmail !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      try {
        let query = {};
        if (userEmail) {
          query = {
            email: userEmail,
          };
        }

        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) // ✅ newest first
          .toArray();

        res.send(parcels);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch parcels" });
      }
    });
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/payments", verifyFirebaseToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        // console.log(userEmail);
        const query = { email: userEmail };
        if (userEmail !== req.decoded.email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
        if (!userEmail) {
          return res.status(400).json({ error: "User email is required" });
        }

        const payments = await paymentCollection
          .find(query)
          .sort({ paid_at: -1 })
          .toArray();
        // console.log(payments);
        res.json(payments);
      } catch (error) {
        console.error("Failed to fetch payment history:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    app.post("/payments", async (req, res) => {
      try {
        const paymentInfo = req.body;
        const id = paymentInfo.id;

        // 1️⃣ Save payment to paymentCollection
        const paymentResult = await paymentCollection.insertOne({
          ...paymentInfo,
          paid_at: new Date(),
          paid_at_string: new Date().toISOString(),
        });

        // 2️⃣ Update status of that parcel in parcelCollection
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { paymentStatus: "paid" } }
        );

        res.status(201).json({
          message: "✅ Payment saved and parcel status updated!",
          insertedId: paymentResult.insertedId,
          updatedCount: updateResult.modifiedCount,
        });
      } catch (error) {
        console.error("❌ Payment save failed:", error);
        res
          .status(500)
          .json({ error: "Failed to save payment info and update parcel" });
      }
    });

    //  riders all api
    app.post("/riders", async (req, res) => {
      try {
        const rider = req.body;

        // Check if rider with same email already exists
        const existing = await riderCollection.findOne({ email: rider.email });
        if (existing) {
          return res.status(409).json({ message: "Rider already registered" });
        }

        const result = await riderCollection.insertOne(rider);
        res.status(201).send(result);
      } catch (error) {
        console.error("❌ Failed to create rider:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.get(
      "/riders/pending",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const pendingRiders = await riderCollection
            .find({ status: "pending" })
            .sort({ createdAt: -1 })
            .toArray();

          res.send(pendingRiders);
        } catch (error) {
          console.error("❌ Failed to fetch pending riders:", error);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );
    app.get(
      "/riders/active",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const activeRiders = await riderCollection
            .find({ status: "approved" })
            .sort({ createdAt: -1 })
            .toArray();

          res.send(activeRiders);
        } catch (err) {
          console.error("❌ Error fetching active riders:", err);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    app.patch("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const { status, email } = req.body;
      const updateDoc = {
        $set: {
          status,
        },
      };
      if (status === "approved") {
        const userQuery = { email };
        const userUpdateDoc = {
          $set: {
            role: "rider",
          },
        };
        const userResult = await userCollection.updateOne(
          userQuery,
          userUpdateDoc
        );
        console.log(userResult.modifiedCount);
      }
      const result = await riderCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc
      );
      res.send(result);
    });
    app.delete("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const result = await riderCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // make admin section
    app.get("/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const search = req.query.search;

        let query = {};

        if (search) {
          query = {
            $or: [
              { name: { $regex: search, $options: "i" } },
              { email: { $regex: search, $options: "i" } },
            ],
          };
        }

        const users = await userCollection.find(query).toArray();
        res.send(users);
      } catch (error) {
        console.error("❌ Error fetching users:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "admin" } }
        );
        res.send(result);
      } catch (error) {
        console.error("❌ Failed to make admin:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.patch("/users/remove_admin/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "user" } }
        );
        res.send(result);
      } catch (error) {
        console.error("❌ Failed to remove admin:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.get(
      "/users/admin/:email",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const user = await userCollection.findOne({ email });

        res.send({ isAdmin: user?.role === "admin" });
      }
    );

    // stripe create intent
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100, // convert to cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Assign Riders

    app.get("/parcels/available/riders", async (req, res) => {
      const query = {
        paymentStatus: "paid",
        deliveryStatus: "not-collected",
      };
      try {
        const parcels = await parcelCollection.find(query).toArray();

        res.send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res
          .status(500)
          .send({ error: true, message: "Failed to load parcels" });
      }
    });

    // ✅ GET: Riders by region or district
    app.get("/riders", async (req, res) => {
      const { region, district } = req.query;
      // console.log(region);

      try {
        const query = {
          status: "approved", // only approved riders
        };

        if (region) {
          query.senderRegion = { $regex: region, $options: "i" }; // case-insensitive match
        }
        // if (district) {
        //   query.senderServiceCenter = { $regex: district, $options: "i" }; // case-insensitive match
        // }

        const result = await riderCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        console.error("Error fetching riders:", err);
        res.status(500).send({ error: true, message: "Failed to load riders" });
      }
    });

    app.patch("/parcels/assign/:id", async (req, res) => {
      const parcelId = req.params.id;
      const { riderId, riderName, riderEmail } = req.body;

      try {
        // 1️⃣ Update Parcel: set deliveryStatus = "in-transition", and assigned rider
        const parcelFilter = { _id: new ObjectId(parcelId) };
        const parcelUpdate = {
          $set: {
            deliveryStatus: "in-transition",
            assignedRider: {
              id: riderId,
              name: riderName,
            },
            assignedAt: new Date(),
            riderEmail: riderEmail,
          },
        };

        const parcelResult = await parcelCollection.updateOne(
          parcelFilter,
          parcelUpdate
        );

        // 2️⃣ Update Rider: set workingStatus = "in-delivery"
        const riderFilter = { _id: new ObjectId(riderId) };
        const riderUpdate = {
          $set: {
            workingStatus: "in-delivery",
          },
        };

        const riderResult = await riderCollection.updateOne(
          riderFilter,
          riderUpdate
        );

        // 3️⃣ Response
        if (parcelResult.modifiedCount > 0 && riderResult.modifiedCount > 0) {
          return res.send({
            success: true,
            message: "Rider assigned successfully",
          });
        }

        res.status(400).send({ success: false, message: "Assignment failed" });
      } catch (error) {
        console.error("Assign Error:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // confirm rider role
    app.get(
      "/users/rider/:email",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const email = req.params.email;
        const user = await userCollection.findOne({ email });
        res.send({ isRider: user?.role === "rider" });
      }
    );

    app.get(
      "/rider/pendingDeliveries/:email",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const email = req.params.email;

        try {
          const result = await parcelCollection
            .find({
              riderEmail: email,
              deliveryStatus: { $in: ["in-transition", "picked-up"] }, // still not delivered
            })
            .toArray();

          res.send(result);
        } catch (err) {
          console.error("Pending Deliveries Error:", err);
          res
            .status(500)
            .send({ error: true, message: "Failed to load deliveries" });
        }
      }
    );

    app.get(
      "/rider/completedDeliveries/:email",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const email = req.params.email;
        try {
          const deliveredParcels = await parcelCollection
            .find({
              riderEmail: email,
              $or: [
                { deliveryStatus: "delivered" },
                { cashOutStatus: "cashed-out" },
              ],
            })
            .toArray();

          res.send(deliveredParcels);
        } catch (err) {
          res
            .status(500)
            .send({ error: true, message: "Failed to load deliveries" });
        }
      }
    );

    app.get("/rider/earnings/:email", async (req, res) => {
      const email = req.params.email;

      const result = await parcelCollection
        .find({ riderEmail: email, deliveryStatus: "delivered" })
        .toArray();

      res.send(result);
    });

    app.patch(
      "/parcels/pickup/:id",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const parcelId = req.params.id;

        try {
          const result = await parcelCollection.updateOne(
            { _id: new ObjectId(parcelId) },
            {
              $set: {
                deliveryStatus: "picked-up",
                pickedUpAt: new Date(),
              },
            }
          );

          res.send(result);
        } catch (err) {
          res
            .status(500)
            .send({ error: true, message: "Failed to mark as picked up" });
        }
      }
    );

    app.patch("/parcels/deliver/:id", async (req, res) => {
      const parcelId = req.params.id;

      try {
        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              deliveryStatus: "delivered",
              deliveredAt: new Date(),
            },
          }
        );

        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ error: true, message: "Failed to mark as delivered" });
      }
    });

    // 📁 routes/parcelRoutes.js বা যেখানে তোমার routes আছে
    app.patch("/parcels/cashOut/:id", async (req, res) => {
      const parcelId = req.params.id;

      try {
        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              cashOutStatus: "cashed-out",
              cashedOutAt: new Date(), // optional: কবে ক্যাশ আউট হয়েছে
            },
          }
        );

        res.send(result);
      } catch (error) {
        console.error("Cash out error:", error);
        res.status(500).send({ message: "Failed to update cashout status" });
      }
    });

    // user tracking package API

    app.get("/parcels/track/:trackingId", async (req, res) => {
      const trackingId = req.params.trackingId;

      try {
        const parcel = await parcelCollection.findOne({ trackingId });

        if (!parcel) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (err) {
        res
          .status(500)
          .send({ error: true, message: "Failed to track parcel" });
      }
    });

    // adminDashBoardHome summary

    // // Example: Admin Dashboard Summary Aggregation

    app.get(
      "/admin/summary",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const totalUsers = await userCollection.countDocuments();
        const totalRiders = await riderCollection.countDocuments();
        const totalParcels = await parcelCollection.countDocuments();
        const paidParcels = await parcelCollection
          .find({ paymentStatus: "paid" })
          .toArray();
        const totalPayments = paidParcels.reduce((sum, p) => sum + p.cost, 0);

        const pendingParcels = await parcelCollection.countDocuments({
          deliveryStatus: "picked-up",
        });
        const inTransition = await parcelCollection.countDocuments({
          deliveryStatus: "in-transition",
        });
        const deliveredParcels = await parcelCollection.countDocuments({
          deliveryStatus: "delivered",
        });

        const pendingRiderRequests = await riderCollection.countDocuments({
          status: "pending",
        });

        res.send({
          totalUsers,
          totalRiders,
          totalParcels,
          totalPayments,
          pendingParcels,
          inTransition,
          deliveredParcels,
          pendingRiderRequests,
        });
      }
    );

    // riderDashboardHome
    app.get(
      "/rider/summary/:email",

      async (req, res) => {
        try {
          const email = req.params.email;

          const summary = await database
            .collection("parcels")
            .aggregate([
              {
                $match: { riderEmail: email },
              },
              {
                $group: {
                  _id: "$deliveryStatus",
                  count: { $sum: 1 },
                },
              },
              {
                $group: {
                  _id: null,
                  counts: {
                    $push: {
                      status: "$_id",
                      count: "$count",
                    },
                  },
                  totalParcels: { $sum: "$count" },
                },
              },
            ])
            .toArray();

          const statusMap = {};
          summary[0]?.counts.forEach((item) => {
            statusMap[item.status] = item.count;
          });

          res.send({
            totalParcels: summary[0]?.totalParcels || 0,
            deliveredParcels: statusMap["delivered"] || 0,
            inTransition: statusMap["in-transition"] || 0,
          });
        } catch (err) {
          console.error(err.message);
          res.status(500).send({
            error: true,
            message: "Failed to load rider dashboard summary",
          });
        }
      }
    );

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("this is zap-shift server");
});

app.listen(port, () => {
  console.log(`Zap shift server  listening on port ${port}`);
});
