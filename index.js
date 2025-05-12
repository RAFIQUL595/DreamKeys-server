const express = require("express");
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is running...");
});

const PORT = process.env.PORT || 5000;

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.q4vm3.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //Collections Section
    const usersCollection = client.db("DreamKeys").collection("users");
    const propertiesCollection = client
      .db("DreamKeys")
      .collection("properties");
    const wishlistCollection = client.db("DreamKeys").collection("wishlist");
    const bidsCollection = client.db("DreamKeys").collection("bids");
    const reviewsCollection = client.db("DreamKeys").collection("reviews");
    const paymentCollection = client.db("DreamKeys").collection("payment");

    // Jwt related apis
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1hr",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verify token
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Get all users
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Post a user
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = user.role || "user";

      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "User already exists", insertedID: null });
      }

      const { photoURL } = user;
      if (photoURL) {
        user.photoURL = photoURL;
      }

      const result = await usersCollection.insertOne(user);

      if (result.insertedId) {
        res.send({
          message: "User successfully registered",
          insertedID: result.insertedId,
        });
      } else {
        res.status(500).send({ message: "Failed to register user" });
      }
    });

    // Get user by role
    app.get("/users/role", async (req, res) => {
      const email = req.query.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role || "user" });
    });

    // Get user by email
    app.get("/users", async (req, res) => {
      const email = req.query.email;
      if (email) {
        const user = await usersCollection.findOne({ email });
        return res.send(user || {});
      }
      res.status(400).send({ error: "Email is required" });
    });

    // Update user
    app.patch("/users/:id/role", (req, res) => {
      const userId = req.params.id;
      const { role } = req.body;

      if (!role) {
        return res.status(400).send({ message: "Role is required" });
      }

      const filter = { _id: new ObjectId(userId) };
      const updateDoc = { $set: { role } };

      usersCollection.updateOne(filter, updateDoc).then((result) => {
        if (result.modifiedCount > 0) {
          res.send({ message: "User role updated successfully" });
        } else {
          res
            .status(404)
            .send({ message: "User not found or role already set" });
        }
      });
    });

    // Delete a user
    app.delete("/users/:id", verifyToken, verifyAdmin, (req, res) => {
      const userId = req.params.id;

      const filter = { _id: new ObjectId(userId) };

      usersCollection.deleteOne(filter).then((result) => {
        if (result.deletedCount > 0) {
          res.send({ message: "User deleted successfully" });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      });
    });

    // Update a user fraud status
    app.patch("/users/:userId/fraud", async (req, res) => {
      const { userId } = req.params;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({ message: "Invalid user ID." });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { isFraud: true } }
        );
        if (result.modifiedCount > 0) {
          res
            .status(200)
            .send({ message: "User marked as fraud successfully." });
        } else {
          res.status(404).send({ message: "User not found." });
        }
      } catch (error) {
        res.status(500).send({ message: "Internal server error.", error });
      }
    });

    // Delete Properties by agent ID
    app.delete("/properties/agent/:userId", async (req, res) => {
      const { userId } = req.params;

      const result = await propertiesCollection.deleteMany({ agentId: userId });
      if (result.deletedCount > 0) {
        res.send({ message: "Agent properties deleted successfully" });
      } else {
        res
          .status(404)
          .send({ message: "No properties found for the given agent" });
      }
    });

    // Add new property
    app.post("/properties", async (req, res) => {
      const propertyData = req.body;
      const verificationStatus = "pending";

      // Add the property to the database
      const result = await propertiesCollection.insertOne({
        ...propertyData,
        verificationStatus,
      });

      if (result.insertedId) {
        res.send({
          message: "Property added successfully",
          insertedID: result.insertedId,
        });
      } else {
        res.status(500).send({ message: "Failed to add property" });
      }
    });

    // Update property
    app.patch("/properties/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      let updatedPropertyData = req.body;

      // Exclude the _id field from the update data if it exists
      delete updatedPropertyData._id;

      try {
        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedPropertyData }
        );

        if (result.modifiedCount > 0) {
          res.send({ message: "Property updated successfully" });
        } else {
          res
            .status(404)
            .send({ message: "Property not found or no changes made" });
        }
      } catch (error) {
        res.status(500).send({ message: "Error updating property", error });
      }
    });

    // Get all properties (filter by agentEmail if provided)
    app.get("/properties", async (req, res) => {
      const { agentEmail } = req.query;

      let query = {};
      if (agentEmail) {
        query.agentEmail = agentEmail;
      }

      const properties = await propertiesCollection.find(query).toArray();
      res.send(properties);
    });

    // Get a single property by ID
    app.get("/properties/:id", async (req, res) => {
      const { id } = req.params;
      const property = await propertiesCollection.findOne({
        _id: new ObjectId(id),
      });
      if (property) {
        res.send(property);
      } else {
        res.status(404).send({ message: "Property not found" });
      }
    });

    // Admin verifies property
    app.patch("/properties/:id/verify", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { verificationStatus } = req.body;

      if (!["verified", "rejected"].includes(verificationStatus)) {
        return res.status(400).send({ message: "Invalid verification status" });
      }

      const result = await propertiesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { verificationStatus } }
      );

      if (result.modifiedCount > 0) {
        res.send({ message: "Property verification status updated" });
      } else {
        res
          .status(404)
          .send({ message: "Property not found or already updated" });
      }
    });

    // Delete property by ID
    app.delete("/properties/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await propertiesCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount > 0) {
        res.send({ message: "Property deleted successfully" });
      } else {
        res.status(404).send({ message: "Property not found" });
      }
    });

    // Update property to be advertised
    app.patch("/properties/:id/advertise", verifyToken, async (req, res) => {
      const { id } = req.params;

      const result = await propertiesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            isAdvertised: true,
            updatedAt: new Date(),
          },
        }
      );

      if (result.modifiedCount > 0) {
        res.send({ message: "Property advertised successfully" });
      } else {
        res
          .status(404)
          .send({ message: "Property not found or already advertised" });
      }
    });

    // Remove property from being advertised
    app.patch(
      "/properties/:id/remove-advertise",
      verifyToken,
      async (req, res) => {
        const { id } = req.params;

        try {
          const result = await propertiesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isAdvertised: false } }
          );

          if (result.modifiedCount > 0) {
            res.send({
              message: "Property advertisement removed successfully",
            });
          } else {
            res
              .status(404)
              .send({ message: "Property not found or not advertised" });
          }
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error removing advertisement", error });
        }
      }
    );

    // Report a property
    app.post("/properties/:id/report", async (req, res) => {
      const { id } = req.params;
      const { reporterName, reporterEmail, reportDescription } = req.body;

      const reportData = {
        propertyId: new ObjectId(id),
        reporterName,
        reporterEmail,
        reportDescription,
      };

      try {
        const result = await reportedPropertiesCollection.insertOne(reportData);
        res.send({
          message: "Property reported successfully",
          reportId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to report property", error });
      }
    });

    // ! WISHLIST
    app.get("/wishlists", async (req, res) => {
      const result = await wishlistCollection.find().toArray();
      res.send(result);
    });

    // Add a property to the wishlist
    app.post("/wishlist", verifyToken, async (req, res) => {
      const { propertyId } = req.body;
      const userEmail = req.decoded.email;

      const property = await propertiesCollection.findOne({
        _id: new ObjectId(propertyId),
      });
      delete property._id;

      const wishlistItem = {
        userEmail,
        propertyId,
        addedAt: new Date(),
        ...property,
      };

      const result = await wishlistCollection.insertOne(wishlistItem);
      res.send({ message: "Added to wishlist", result });
    });

    // Fetch all wishlist items for a user
    app.get("/wishlist", verifyToken, async (req, res) => {
      const userEmail = req.decoded.email;

      const wishlistItems = await wishlistCollection
        .find({ userEmail })
        .toArray();

      res.send(wishlistItems);
    });

    // Get a single wishlist by ID
    app.get("/wishlist/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.decoded.email;
      const wishlistItems = await wishlistCollection.findOne({
        _id: new ObjectId(id),
        userEmail,
      });
      res.send(wishlistItems);
    });

    // Remove a property from the wishlist
    app.delete("/wishlist/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.decoded.email;

      const result = await wishlistCollection.deleteOne({
        _id: new ObjectId(id),
        userEmail,
      });

      if (result.deletedCount > 0) {
        res.send({ message: "Property removed from wishlist" });
      } else {
        res.status(404).send({ message: "Property not found in wishlist" });
      }
    });

    // Get all bids
    app.get("/bidss", async (req, res) => {
      const result = await bidsCollection.find().toArray();
      res.send(result);
    });

    // Add a bid
    app.post("/bids", verifyToken, async (req, res) => {
      const {
        propertyId,
        propertyTitle,
        agentEmail,
        offerAmount,
        buyerName,
        buyingDate,
      } = req.body;

      const userEmail = req.decoded.email;

      const bidItem = {
        propertyId,
        propertyTitle,
        agentEmail,
        offerAmount,
        buyingDate,
        buyerName,
        buyerEmail: userEmail,
        status: "pending",
      };

      const bid = await bidsCollection.insertOne(bidItem);
      if (!bid) {
        return res.status(404).send({ message: "bid not found" });
      }

      res.send({ message: "Bid Added Successfully", bid });
    });

    // Get all bids for a user
    app.get("/bids/:email", async (req, res) => {
      const email = req.params.email;
      const bids = await bidsCollection.find({ buyerEmail: email }).toArray();
      const bidItems = await Promise.all(
        bids.map(async (bid) => {
          const id = bid.propertyId;
          const propertyItem = await propertiesCollection.findOne({
            _id: new ObjectId(id),
          });
          return {
            ...propertyItem,
            offerAmount: bid.offerAmount,
            offerStatus: bid.status,
            _id: new ObjectId(bid._id),
            propertyId: bid.propertyId,
          };
        })
      );

      res.send(bidItems);
    });

    // Get all bid by id
    app.get("/get-bid/:id", async (req, res) => {
      const id = req.params.id;
      const bids = await bidsCollection.findOne({ _id: new ObjectId(id) });
      res.send(bids);
    });

    // Get all bids for an agent
    app.get("/agentBids/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const bids = await bidsCollection.find({ agentEmail: email }).toArray();

      const bidItems = await Promise.all(
        bids.map(async (bid) => {
          const id = bid.propertyId;
          const propertyItem = await propertiesCollection.findOne({
            _id: new ObjectId(id),
          });
          return {
            ...propertyItem,
            offerAmount: bid.offerAmount,
            offerStatus: bid.status,
            _id: new ObjectId(bid._id),
            propertyId: bid.propertyId,
            buyingDate: bid.buyingDate,
            buyerName: bid.buyerName,
            buyerEmail: bid.buyerEmail,
          };
        })
      );

      res.send(bidItems);
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
    // Send a ping to confirm a successful connection
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
