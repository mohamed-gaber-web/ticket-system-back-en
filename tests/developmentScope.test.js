/**
 * Tests for developmentScope.js — who may see and shape a development board.
 * Pure decision functions; no database.
 *
 * Run with: node --test tests/developmentScope.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  canSeeAllBoards,
  isBoardCreator,
  isBoardMember,
  boardScopeFilter,
  canViewBoard,
  canAdminBoard,
  canDeleteComment,
} from "../src/utils/developmentScope.js";

const oid = () => new mongoose.Types.ObjectId();

const admin = { _id: oid(), role: "admin" };
const devManager = { _id: oid(), role: "developer_manager" };
const salesManager = { _id: oid(), role: "sales_manager" };
const creator = { _id: oid(), role: "developer" };
const member = { _id: oid(), role: "developer" };
const stranger = { _id: oid(), role: "developer" };
const overridden = { _id: oid(), role: "consultant", modules: ["development"] };

const board = { _id: oid(), createdBy: creator._id, members: [creator._id, member._id] };
// The same board as a controller sees it after populate()
const populatedBoard = {
  _id: board._id,
  createdBy: { _id: creator._id, firstName: "A" },
  members: [{ _id: creator._id }, { _id: member._id }],
};

describe("canSeeAllBoards", () => {
  it("is admins and the development manager only", () => {
    assert.equal(canSeeAllBoards(admin), true);
    assert.equal(canSeeAllBoards(devManager), true);
    assert.equal(canSeeAllBoards(salesManager), false);
    assert.equal(canSeeAllBoards(creator), false);
    assert.equal(canSeeAllBoards(overridden), false);
    assert.equal(canSeeAllBoards(null), false);
  });
});

describe("membership", () => {
  it("recognises creator and members whether ids are bare or populated", () => {
    for (const b of [board, populatedBoard]) {
      assert.equal(isBoardCreator(creator, b), true);
      assert.equal(isBoardCreator(member, b), false);
      assert.equal(isBoardMember(creator, b), true);
      assert.equal(isBoardMember(member, b), true);
      assert.equal(isBoardMember(stranger, b), false);
    }
  });
});

describe("boardScopeFilter", () => {
  it("is unrestricted for those who see everything", () => {
    assert.deepEqual(boardScopeFilter(admin), {});
    assert.deepEqual(boardScopeFilter(devManager), {});
  });

  it("pins everyone else to boards they created or belong to", () => {
    const f = boardScopeFilter(member);
    assert.deepEqual(f, { $or: [{ members: member._id }, { createdBy: member._id }] });
  });

  it("fails closed for a caller with no id", () => {
    assert.deepEqual(boardScopeFilter(null), { _id: { $in: [] } });
    assert.deepEqual(boardScopeFilter({ role: "developer" }), { _id: { $in: [] } });
  });
});

describe("canViewBoard / canAdminBoard", () => {
  it("lets every member work the board, but only the creator shape it", () => {
    assert.equal(canViewBoard(member, board), true);
    assert.equal(canAdminBoard(member, board), false);
    assert.equal(canViewBoard(creator, board), true);
    assert.equal(canAdminBoard(creator, board), true);
  });

  it("keeps strangers out entirely — even another developer", () => {
    assert.equal(canViewBoard(stranger, board), false);
    assert.equal(canAdminBoard(stranger, board), false);
  });

  it("lets admins and the development manager do anything on any board", () => {
    assert.equal(canViewBoard(admin, board), true);
    assert.equal(canAdminBoard(admin, board), true);
    assert.equal(canViewBoard(devManager, board), true);
    assert.equal(canAdminBoard(devManager, board), true);
  });

  it("does not let another family's manager in by rank alone", () => {
    assert.equal(canViewBoard(salesManager, board), false);
  });

  it("answers false for a missing board", () => {
    assert.equal(canViewBoard(admin, null), false);
    assert.equal(canAdminBoard(admin, undefined), false);
  });
});

describe("canDeleteComment", () => {
  const comment = { _id: oid(), author: member._id };

  it("is the author or a board admin", () => {
    assert.equal(canDeleteComment(member, board, comment), true);
    assert.equal(canDeleteComment(creator, board, comment), true);
    assert.equal(canDeleteComment(devManager, board, comment), true);
    assert.equal(canDeleteComment(stranger, board, comment), false);
  });

  it("does not let a fellow member delete someone else's comment", () => {
    const other = { _id: oid(), role: "developer" };
    const wide = { ...board, members: [...board.members, other._id] };
    assert.equal(canDeleteComment(other, wide, comment), false);
  });
});
