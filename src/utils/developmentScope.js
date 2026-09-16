import mongoose from "mongoose";
import { isAdmin, isManager, roleFamily } from "./access.js";

/**
 * The single authority for "what may this caller see and touch on the
 * development boards?". Pure functions — no database — so the rules can be
 * unit-tested and every controller reaches them through one door.
 *
 * Model:
 *   admin              → every board, every action
 *   developer_manager  → every board, every action (runs the developer people)
 *   developer          → the boards they created or were added to as a member
 *   anyone else with an admin-granted `development` module override behaves
 *   like a `developer`.
 *
 * Two levels inside a board:
 *   VIEW  = work the board: create/rename/reorder lists, create/edit/move cards,
 *           checklist, comments. Every member has it — the board is shared.
 *   ADMIN = shape the board: rename/archive/delete it, members, labels, delete
 *           lists. The creator has it, plus anyone who sees every board.
 *
 * Out-of-scope reads answer 404 (never confirm a board exists); an in-scope
 * caller without the admin level gets a 403 with a reason.
 */

const idOf = (value) => {
  if (!value) return null;
  const id = value._id ?? value;
  return id ? String(id) : null;
};

const callerId = (user) => idOf(user?._id ?? user);

// ── Role predicates ───────────────────────────────────────────────────────────

/** Sees and shapes every board: admins and the development manager. */
export const canSeeAllBoards = (user) =>
  isAdmin(user) || (isManager(user) && roleFamily(user?.role) === "developer");

// ── Board membership ──────────────────────────────────────────────────────────

export const isBoardCreator = (user, board) => {
  const me = callerId(user);
  return Boolean(me) && idOf(board?.createdBy) === me;
};

/** Named on the board: creator or listed member. */
export const isBoardMember = (user, board) => {
  const me = callerId(user);
  if (!me) return false;
  if (isBoardCreator(user, board)) return true;
  return (board?.members ?? []).some((m) => idOf(m) === me);
};

// ── Decisions ─────────────────────────────────────────────────────────────────

/**
 * Spread into every board list/count. Fails closed: a caller with no id
 * matches nothing, never everything.
 */
export const boardScopeFilter = (user) => {
  if (canSeeAllBoards(user)) return {};
  const me = callerId(user);
  if (!me || !mongoose.Types.ObjectId.isValid(me)) return { _id: { $in: [] } };
  const oid = new mongoose.Types.ObjectId(me);
  return { $or: [{ members: oid }, { createdBy: oid }] };
};

/** May open the board and work its lists and cards. */
export const canViewBoard = (user, board) =>
  Boolean(board) && (canSeeAllBoards(user) || isBoardMember(user, board));

/** May rename/archive/delete the board, edit members and labels, delete lists. */
export const canAdminBoard = (user, board) =>
  Boolean(board) && (canSeeAllBoards(user) || isBoardCreator(user, board));

/** May delete this comment: its author or a board admin. */
export const canDeleteComment = (user, board, comment) =>
  canAdminBoard(user, board) || (Boolean(callerId(user)) && idOf(comment?.author) === callerId(user));

export const BOARD_ADMIN_MESSAGE = "Only the board creator or a development manager can do that.";
