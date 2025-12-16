import Customer from "../models/Customer.js";

// @desc    Get all customers
// @route   GET /api/customers
// @access  Public
const getAllCustomers = async (req, res) => {
  try {
    const { status, page = 1, limit = 10, search } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { contactPerson: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const customers = await Customer.find(query)
      .populate("slaMapping", "name responseTime resolutionTime")
      .populate("versionNumber", "name isActive")
      .populate("erpType", "name isActive")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Customer.countDocuments(query);

    res.status(200).json({
      success: true,
      count: customers.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: customers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching customers",
      error: error.message,
    });
  }
};

// @desc    Get single customer by ID
// @route   GET /api/customers/:id
// @access  Public
const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate("slaMapping", "name responseTime resolutionTime")
      .populate("versionNumber", "name isActive")
      .populate("erpType", "name isActive")
      .populate({
        path: "tickets",
        select: "title status priority createdAt",
      });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching customer",
      error: error.message,
    });
  }
};

// @desc    Create new customer
// @route   POST /api/customers
// @access  Public
const createCustomer = async (req, res) => {
  try {
    const {
      companyName,
      contactPerson,
      email,
      password,
      phone,
      address,
      city,
      country,
      status,
      slaMapping,
      versionNumber,
      erpType,
    } = req.body;

    const customerExists = await Customer.findOne({ email });

    if (customerExists) {
      return res.status(400).json({
        success: false,
        message: "Customer with this email already exists",
      });
    }

    const customer = await Customer.create({
      companyName,
      contactPerson,
      email,
      password,
      phone,
      address,
      city,
      country,
      status,
      slaMapping,
      versionNumber,
      erpType,
    });

    const populatedCustomer = await Customer.findById(customer._id)
      .populate("slaMapping", "name responseTime resolutionTime")
      .populate("versionNumber", "name isActive")
      .populate("erpType", "name isActive");

    res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: populatedCustomer,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error creating customer",
      error: error.message,
    });
  }
};

// @desc    Update customer
// @route   PUT /api/customers/:id
// @access  Public
const updateCustomer = async (req, res) => {
  try {
    const {
      companyName,
      contactPerson,
      email,
      password,
      phone,
      address,
      city,
      country,
      status,
      slaMapping,
      versionNumber,
      erpType,
    } = req.body;

    let customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (email && email !== customer.email) {
      const emailExists = await Customer.findOne({ email });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another customer",
        });
      }
      customer.email = email;
    }

    customer.companyName = companyName || customer.companyName;
    customer.contactPerson = contactPerson || customer.contactPerson;
    customer.phone = phone || customer.phone;
    customer.address = address || customer.address;
    customer.city = city || customer.city;
    customer.country = country || customer.country;
    customer.status = status || customer.status;
    customer.slaMapping = slaMapping || customer.slaMapping;
    customer.versionNumber = versionNumber || customer.versionNumber;
    customer.erpType = erpType || customer.erpType;

    if (password) {
      customer.password = password;
    }

    await customer.save();

    const populatedCustomer = await Customer.findById(customer._id)
      .populate("slaMapping", "name responseTime resolutionTime")
      .populate("versionNumber", "name isActive")
      .populate("erpType", "name isActive");

    res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      data: populatedCustomer,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating customer",
      error: error.message,
    });
  }
};

// @desc    Delete customer
// @route   DELETE /api/customers/:id
// @access  Public
const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    await customer.deleteOne();

    res.status(200).json({
      success: true,
      message: "Customer deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting customer",
      error: error.message,
    });
  }
};

// @desc    Get customer statistics
// @route   GET /api/customers/stats
// @access  Public
const getCustomerStats = async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const activeCustomers = await Customer.countDocuments({ status: "active" });
    const inactiveCustomers = await Customer.countDocuments({
      status: "inactive",
    });
    const suspendedCustomers = await Customer.countDocuments({
      status: "suspended",
    });

    res.status(200).json({
      success: true,
      data: {
        total: totalCustomers,
        active: activeCustomers,
        inactive: inactiveCustomers,
        suspended: suspendedCustomers,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching customer statistics",
      error: error.message,
    });
  }
};

export {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerStats,
};
