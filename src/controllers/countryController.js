import Country from "../models/Country.js";

// @desc    Create a new country
// @route   POST /api/countries
// @access  Public
export const createCountry = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Country name is required",
      });
    }

    const countryData = {
      name: name.trim(),
    };

    if (description) {
      countryData.description = description.trim();
    }

    if (typeof isActive === "boolean") {
      countryData.isActive = isActive;
    }

    const country = new Country(countryData);

    await country.save();

    res.status(201).json({
      success: true,
      message: "Country created successfully",
      data: country,
    });
  } catch (error) {
    console.error("Error creating country:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Country name already exists",
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
      message: error.message || "Failed to create country",
    });
  }
};

// @desc    Get all countries
// @route   GET /api/countries
// @access  Public
export const getAllCountries = async (req, res) => {
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
    const total = await Country.countDocuments(query);

    const countries = await Country.find(query)
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: countries.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      pages: Math.ceil(total / parseInt(limit)),
      data: countries,
    });
  } catch (error) {
    console.error("Error fetching countries:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching countries",
      error: error.message,
    });
  }
};

// @desc    Get a single country by ID
// @route   GET /api/countries/:id
// @access  Public
export const getCountryById = async (req, res) => {
  try {
    const country = await Country.findById(req.params.id);

    if (!country) {
      return res.status(404).json({
        success: false,
        message: "Country not found",
      });
    }

    res.status(200).json({
      success: true,
      data: country,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Country not found",
      });
    }
    console.error("Error fetching country:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching country",
      error: error.message,
    });
  }
};

// @desc    Update a country by ID
// @route   PATCH /api/countries/:id
// @access  Public
export const updateCountry = async (req, res) => {
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
    const country = await Country.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!country) {
      return res.status(404).json({
        success: false,
        message: "Country not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Country updated successfully",
      data: country,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Country name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating country:", error);
    res.status(500).json({
      success: false,
      message: "Error updating country",
      error: error.message,
    });
  }
};

// @desc    Delete a country by ID
// @route   DELETE /api/countries/:id
// @access  Public
export const deleteCountry = async (req, res) => {
  try {
    const country = await Country.findByIdAndDelete(req.params.id);

    if (!country) {
      return res.status(404).json({
        success: false,
        message: "Country not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Country deleted successfully",
      data: country,
    });
  } catch (error) {
    console.error("Error deleting country:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting country",
      error: error.message,
    });
  }
};

// @desc    Toggle country active status
// @route   PATCH /api/countries/:id/toggle-status
// @access  Public
export const toggleCountryStatus = async (req, res) => {
  try {
    const country = await Country.findById(req.params.id);

    if (!country) {
      return res.status(404).json({
        success: false,
        message: "Country not found",
      });
    }

    country.isActive = !country.isActive;
    await country.save();

    res.status(200).json({
      success: true,
      message: `Country ${country.isActive ? "activated" : "deactivated"} successfully`,
      data: country,
    });
  } catch (error) {
    console.error("Error toggling country status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling country status",
      error: error.message,
    });
  }
};
