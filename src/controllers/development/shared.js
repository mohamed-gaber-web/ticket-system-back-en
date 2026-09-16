import mongoose from "mongoose";
import DevBoard from "../../models/DevBoard.js";
import Consultant from "../../models/Consltant.js";
import { hasModule } from "../../utils/access.js";
import { canViewBoard, canAdminBoard, BOARD_ADMIN_MESSAGE } from "../../utils/developmentScope.js";

/**
 * Helpers every development controller shares — the response envelope, the
 * error mapping and the one way to load a board the caller is allowed to see.
 */

export const PERSON_FIELDS = "firstName lastName email profilePicture position";

export const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id));

export const ok = (res, data, message) =>
  res.status(200).json({ success: true, ...(message ? { message } : {}), data });

export const created = (res, data, message) =>
  res.status(201).json({ success: true, ...(message ? { message } : {}), data });

export const notFound = (res, what = "Board") =>
  res.status(404).json({ success: false, message: `${what} not found` });

export const forbidden = (res, message = BOARD_ADMIN_MESSAGE) =>
  res.status(403).json({ success: false, message });

export const badRequest = (res, message, errors) =>
  res.status(400).json({ success: false, message, ...(errors ? { errors } : {}) });

/** Map a thrown error onto the codebase's usual status codes. */
export const fail = (res, error, message) => {
  if (error?.name === "ValidationError") {
    const errors = Object.values(error.errors).map((e) => e.message);
    return badRequest(res, "Validation error", errors);
  }
  if (error?.name === "CastError") return notFound(res, "Resource");
  return res.status(500).json({ success: false, message, error: error?.message });
};

/**
 * The board behind `id`, or null when it does not exist OR the caller may not
 * see it — the two cases are indistinguishable on purpose (answer 404).
 */
export const loadBoardInScope = async (req, id) => {
  if (!isValidId(id)) return null;
  const board = await DevBoard.findById(id);
  return board && canViewBoard(req.user, board) ? board : null;
};

/** Like loadBoardInScope, but the caller must also be a board admin (403). */
export const requireBoardAdmin = (req, res, board) => {
  if (canAdminBoard(req.user, board)) return true;
  forbidden(res);
  return false;
};

/**
 * Filter a list of employee ids down to active people who can open the
 * development module. Returns the valid ids and the ones that were refused.
 */
export const validDevelopers = async (ids = []) => {
  const wanted = [...new Set((ids ?? []).map(String).filter(isValidId))];
  if (!wanted.length) return { ids: [], invalid: [] };
  const people = await Consultant.find({ _id: { $in: wanted }, status: "active" }).select("role modules");
  const okIds = people.filter((p) => hasModule(p, "development")).map((p) => String(p._id));
  const invalid = wanted.filter((id) => !okIds.includes(id));
  return { ids: okIds, invalid };
};

/** Board-level: every label id on a card must be one of the board's labels. */
export const invalidLabels = (board, labelIds = []) => {
  const known = new Set((board.labels ?? []).map((l) => String(l._id)));
  return (labelIds ?? []).map(String).filter((id) => !known.has(id));
};
