import Company from "../models/Company.js";

// @desc    Create a new company
// @route   POST /api/companies
// @access  Public
export const createCompany = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Company name is required",
      });
    }

    const companyData = {
      name: name.trim(),
    };

    if (description) {
      companyData.description = description.trim();
    }

    if (typeof isActive === "boolean") {
      companyData.isActive = isActive;
    }

    const company = new Company(companyData);

    await company.save();

    res.status(201).json({
      success: true,
      message: "Company created successfully",
      data: company,
    });
  } catch (error) {
    console.error("Error creating company:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Company name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || "Failed to create company",
    });
  }
};

// @desc    Get all companies
// @route   GET /api/companies
// @access  Public
export const getAllCompanies = async (req, res) => {
  try {
    const { isActive, page = 1, limit = 10, search } = req.query;

    const query = {};

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Company.countDocuments(query);

    const companies = await Company.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: companies.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: companies,
    });
  } catch (error) {
    console.error("Error fetching companies:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching companies",
      error: error.message,
    });
  }
};

// @desc    Get a single company by ID
// @route   GET /api/companies/:id
// @access  Public
export const getCompanyById = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    res.status(200).json({
      success: true,
      data: company,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }
    console.error("Error fetching company:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching company",
      error: error.message,
    });
  }
};

// @desc    Update a company by ID
// @route   PATCH /api/companies/:id
// @access  Public
export const updateCompany = async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = ["name", "description", "isActive"];
  const isValidOperation = updates.every((update) =>
    allowedUpdates.includes(update)
  );

  if (!isValidOperation) {
    return res.status(400).json({
      success: false,
      message: "Invalid updates!",
      allowedFields: allowedUpdates,
    });
  }

  try {
    const company = await Company.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Company updated successfully",
      data: company,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Company name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating company:", error);
    res.status(500).json({
      success: false,
      message: "Error updating company",
      error: error.message,
    });
  }
};

// @desc    Delete a company by ID
// @route   DELETE /api/companies/:id
// @access  Public
export const deleteCompany = async (req, res) => {
  try {
    const company = await Company.findByIdAndDelete(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Company deleted successfully",
      data: company,
    });
  } catch (error) {
    console.error("Error deleting company:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting company",
      error: error.message,
    });
  }
};

// @desc    Toggle company active status
// @route   PATCH /api/companies/:id/toggle-status
// @access  Public
export const toggleCompanyStatus = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    company.isActive = !company.isActive;
    await company.save();

    res.status(200).json({
      success: true,
      message: `Company ${company.isActive ? "activated" : "deactivated"} successfully`,
      data: company,
    });
  } catch (error) {
    console.error("Error toggling company status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling company status",
      error: error.message,
    });
  }
};
