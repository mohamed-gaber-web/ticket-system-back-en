import mongoose from "mongoose";
import Company from "../models/Company.js";
import Customer from "../models/Customer.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { ACCOUNT_CONTACT_FIELDS } from "./leadController.js";

/**
 * Existing-customer lookups for the lead form. The tele-sales module can't read
 * the ticketing customer list itself (that is the tickets module's), so these
 * two read-only endpoints hand it only what the form needs: company names, and
 * each company's contacts with their contact details — never login data.
 */

const MAX_ACCOUNTS = 200;
const MAX_CONTACTS = 100;
// Customer users that are still a live contact (not inactive / suspended).
const LIVE_CONTACT = { status: { $in: ["active", "pending"] } };

// @desc    Active companies (accounts) to pick an existing customer from
// @route   GET /api/leads/accounts?search=
// @access  Private (telesales writers — not read-only roles)
export const getLeadAccounts = async (req, res) => {
  try {
    const filter = { isActive: { $ne: false } };
    const search = String(req.query.search ?? "").trim();
    if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };
    const accounts = await Company.find(filter).select("name").sort({ name: 1 }).limit(MAX_ACCOUNTS).lean();
    res.status(200).json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching accounts", error: error.message });
  }
};

// @desc    The contacts (customer users) of one company, with the details the
//          lead form copies: name, email, phone, address, city, country
// @route   GET /api/leads/accounts/:id/contacts
// @access  Private (telesales writers — not read-only roles)
export const getLeadAccountContacts = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }
    // Only an active company's live contacts — an inactive account answers as missing.
    if (!(await Company.exists({ _id: req.params.id, isActive: { $ne: false } }))) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }
    const contacts = await Customer.find({ company: req.params.id, ...LIVE_CONTACT })
      .select(ACCOUNT_CONTACT_FIELDS)
      .sort({ contactPerson: 1 })
      .limit(MAX_CONTACTS)
      .lean();
    res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching contacts", error: error.message });
  }
};
