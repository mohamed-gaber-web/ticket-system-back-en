/**
 * Ticket types (customer / internal / R&D): the vocabulary, the R&D visibility
 * rule (admins + one configured department, by id), the customer-only
 * notification guard, the model's "customer only for customer tickets" rule and
 * the R&D → development board matching. No database: the R&D department cache
 * is primed directly, and only code paths that never query are exercised.
 *
 * Run with: node --test tests/ticketTypes.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  ticketTypeOf,
  isCustomerTicket,
  isRndTicket,
  ticketTypeFilter,
  customerTicketFilter,
  notRndFilter,
  ticketTypePrefix,
  resolveTicketType,
  INVALID_TICKET_TYPE_MESSAGE,
} from "../src/utils/ticketTypes.js";
import { canSeeRnd, canSeeRndWith, primeRndDepartmentCache } from "../src/utils/access.js";
import { rndHiddenFrom, rndScopeFilter } from "../src/utils/ticketVisibility.js";
import { withoutCustomerUnlessCustomerTicket } from "../src/utils/emailHelper.js";
import { boardsForTicketFilter, cardOwners, importsAsRnd } from "../src/utils/devTicketSync.js";
import Ticket from "../src/models/Ticket.js";

const oid = () => new mongoose.Types.ObjectId();
const rndDept = oid();
const otherDept = oid();

const admin = { _id: oid(), role: "admin" };
const rndMember = { _id: oid(), role: "consultant", department: rndDept };
const rndExtraDept = { _id: oid(), role: "developer", department: otherDept, departments: [rndDept] };
const rndPopulated = { _id: oid(), role: "consultant", department: { _id: rndDept, name: "R&D" } };
const outsider = { _id: oid(), role: "consultant", department: otherDept };
// A customer carries a company role, never an employee role — and even a forged
// department must not let one in.
const customer = { _id: oid(), role: "company_admin", department: rndDept };

describe("ticket type vocabulary", () => {
  it("reads a missing or unknown type as customer", () => {
    assert.equal(ticketTypeOf({}), "customer");
    assert.equal(ticketTypeOf({ ticketType: "bogus" }), "customer");
    assert.equal(ticketTypeOf({ ticketType: "rnd" }), "rnd");
    assert.equal(isCustomerTicket({}), true);
    assert.equal(isCustomerTicket(null), true);
    assert.equal(isCustomerTicket({ ticketType: "internal" }), false);
    assert.equal(isRndTicket({ ticketType: "rnd" }), true);
    assert.equal(isRndTicket({}), false);
  });

  it("filters customer tickets including legacy docs, and never with $or", () => {
    assert.deepEqual(ticketTypeFilter("customer"), { ticketType: { $nin: ["internal", "rnd"] } });
    assert.deepEqual(ticketTypeFilter("internal"), { ticketType: "internal" });
    assert.deepEqual(ticketTypeFilter("rnd"), { ticketType: "rnd" });
    assert.equal(ticketTypeFilter("everything"), null);
    assert.deepEqual(notRndFilter(), { ticketType: { $ne: "rnd" } });
  });

  it("hands out a fresh filter object each time", () => {
    assert.notEqual(customerTicketFilter(), customerTicketFilter());
    assert.notEqual(customerTicketFilter().ticketType, customerTicketFilter().ticketType);
  });

  it("numbers customer-less tickets by type", () => {
    assert.equal(ticketTypePrefix("internal"), "INT");
    assert.equal(ticketTypePrefix("rnd"), "RND");
    assert.equal(ticketTypePrefix("customer"), "TKT");
    assert.equal(ticketTypePrefix(undefined), "TKT");
  });
});

describe("resolveTicketType", () => {
  it("forces customers to customer tickets whatever they send", () => {
    assert.deepEqual(resolveTicketType({ isCustomerCaller: true, requested: "rnd" }), { type: "customer" });
    assert.deepEqual(resolveTicketType({ isCustomerCaller: true, requested: "internal", current: "internal" }), {
      type: "customer",
    });
  });

  it("lets staff pick a valid type, defaulting to customer on create and the current type on edit", () => {
    assert.deepEqual(resolveTicketType({ isCustomerCaller: false, requested: "internal" }), { type: "internal" });
    assert.deepEqual(resolveTicketType({ isCustomerCaller: false }), { type: "customer" });
    assert.deepEqual(resolveTicketType({ isCustomerCaller: false, requested: "", current: "rnd" }), { type: "rnd" });
    assert.deepEqual(resolveTicketType({ isCustomerCaller: false, current: undefined }), { type: "customer" });
  });

  it("refuses an unknown type", () => {
    assert.deepEqual(resolveTicketType({ isCustomerCaller: false, requested: "secret" }), {
      error: INVALID_TICKET_TYPE_MESSAGE,
    });
  });
});

describe("canSeeRndWith (pure)", () => {
  it("admins always; employees of the configured department by id (primary, extra or populated)", () => {
    assert.equal(canSeeRndWith(admin, rndDept), true);
    assert.equal(canSeeRndWith(rndMember, rndDept), true);
    assert.equal(canSeeRndWith(rndMember, String(rndDept)), true);
    assert.equal(canSeeRndWith(rndExtraDept, rndDept), true);
    assert.equal(canSeeRndWith(rndPopulated, rndDept), true);
    assert.equal(canSeeRndWith(outsider, rndDept), false);
  });

  it("with no department configured only admins see R&D", () => {
    assert.equal(canSeeRndWith(admin, null), true);
    assert.equal(canSeeRndWith(rndMember, null), false);
  });

  it("never lets a customer in", () => {
    assert.equal(canSeeRndWith(customer, rndDept), false);
    assert.equal(canSeeRndWith(null, rndDept), false);
  });
});

describe("canSeeRnd (cached setting)", () => {
  it("follows the configured department and picks up a change at once", async () => {
    primeRndDepartmentCache(rndDept);
    assert.equal(await canSeeRnd(admin), true);
    assert.equal(await canSeeRnd(rndMember), true);
    assert.equal(await canSeeRnd(outsider), false);
    assert.equal(await canSeeRnd(customer), false);

    primeRndDepartmentCache(otherDept);
    assert.equal(await canSeeRnd(rndMember), false);
    assert.equal(await canSeeRnd(outsider), true);

    primeRndDepartmentCache(null);
    assert.equal(await canSeeRnd(outsider), false);
    assert.equal(await canSeeRnd(admin), true);
  });
});

describe("ticketVisibility", () => {
  it("hides R&D tickets from callers without access and nothing else", async () => {
    primeRndDepartmentCache(rndDept);
    const rnd = { _id: oid(), ticketType: "rnd" };
    assert.equal(await rndHiddenFrom({ user: outsider }, rnd), true);
    assert.equal(await rndHiddenFrom({ user: customer }, rnd), true);
    assert.equal(await rndHiddenFrom({ user: rndMember }, rnd), false);
    assert.equal(await rndHiddenFrom({ user: admin }, rnd), false);
    assert.equal(await rndHiddenFrom({ user: outsider }, { ticketType: "internal" }), false);
    assert.equal(await rndHiddenFrom({ user: outsider }, {}), false);
  });

  it("adds the not-R&D fence to lists only for callers without access", async () => {
    primeRndDepartmentCache(rndDept);
    assert.deepEqual(await rndScopeFilter({ user: outsider }), { ticketType: { $ne: "rnd" } });
    assert.deepEqual(await rndScopeFilter({ user: customer }), { ticketType: { $ne: "rnd" } });
    assert.equal(await rndScopeFilter({ user: rndMember }), null);
    assert.equal(await rndScopeFilter({ user: admin }), null);
  });
});

describe("notifications reach the customer only on customer tickets", () => {
  const customerId = oid();
  const employeeId = oid();
  const recipients = [
    { userId: customerId, userType: "customer" },
    { userId: employeeId, userType: "employee" },
  ];

  it("leaves customer tickets (and legacy ones) alone", async () => {
    for (const ticketType of ["customer", null]) {
      const data = { ticket: { _id: oid(), ticketType, customer: { _id: customerId } }, recipients };
      const out = await withoutCustomerUnlessCustomerTicket(data);
      assert.equal(out, data);
    }
  });

  it("drops every customer recipient and the customer e-mails for internal and R&D tickets", async () => {
    for (const ticketType of ["internal", "rnd"]) {
      const ticket = { _id: oid(), ticketType, customer: { _id: customerId, email: "c@x.com" } };
      // Reminder e-mails list the customer document itself, without a userType
      const out = await withoutCustomerUnlessCustomerTicket({
        ticket,
        recipients: [...recipients, { _id: customerId, email: "c@x.com" }],
        recipient: ticket.customer,
      });
      assert.equal(out.customerFacing, false);
      assert.deepEqual(out.recipients, [{ userId: employeeId, userType: "employee" }]);
      assert.equal(out.recipient, null);
    }
  });
});

describe("Ticket model: customer only for customer tickets", () => {
  const base = { subject: "S", description: "D", category: oid() };

  it("requires a customer on customer tickets, including when no type is given", () => {
    assert.ok(new Ticket({ ...base, ticketType: "customer" }).validateSync()?.errors?.customer);
    assert.ok(new Ticket({ ...base }).validateSync()?.errors?.customer);
  });

  it("accepts internal and R&D tickets without a customer, with a requester", () => {
    for (const ticketType of ["internal", "rnd"]) {
      const err = new Ticket({ ...base, ticketType, requestedBy: oid() }).validateSync();
      assert.equal(err?.errors?.customer, undefined);
    }
  });

  it("refuses an unknown type", () => {
    assert.ok(new Ticket({ ...base, customer: oid(), ticketType: "secret" }).validateSync()?.errors?.ticketType);
  });
});

describe("development boards: R&D import", () => {
  const dept = oid();
  const person = oid();
  const setBy = oid();
  const ruleSetBy = oid();
  const board = {
    _id: oid(),
    ticketRule: { department: dept, employee: person, setBy: ruleSetBy },
    rndImport: { enabled: true, list: null, setBy },
  };

  it("matches R&D tickets to importing boards with no department or assignee condition", () => {
    assert.deepEqual(boardsForTicketFilter({ ticketType: "rnd" }, []), { archived: false, "rndImport.enabled": true });
  });

  it("ORs the ticket rule and the R&D import for an assigned R&D ticket", () => {
    const f = boardsForTicketFilter({ ticketType: "rnd", department: dept }, [String(person)]);
    assert.deepEqual(f, {
      archived: false,
      $or: [
        { "ticketRule.department": dept, "ticketRule.employee": { $in: [String(person)] } },
        { "rndImport.enabled": true },
      ],
    });
  });

  it("keeps the ticket rule alone for other tickets, and matches nothing without department/assignee", () => {
    assert.deepEqual(boardsForTicketFilter({ ticketType: "internal", department: dept }, ["a"]), {
      archived: false,
      "ticketRule.department": dept,
      "ticketRule.employee": { $in: ["a"] },
    });
    assert.equal(boardsForTicketFilter({ ticketType: "customer", department: dept }, []), null);
    assert.equal(boardsForTicketFilter({}, ["a"]), null);
  });

  it("imports only R&D tickets, only while enabled", () => {
    assert.equal(importsAsRnd(board, { ticketType: "rnd" }), true);
    assert.equal(importsAsRnd(board, { ticketType: "internal" }), false);
    assert.equal(importsAsRnd({ rndImport: { enabled: false } }, { ticketType: "rnd" }), false);
    assert.equal(importsAsRnd({}, { ticketType: "rnd" }), false);
  });

  it("gives R&D cards to the first assignee (or nobody), created by whoever enabled the import", () => {
    assert.deepEqual(cardOwners(board, "rnd", ["x", "y"]), { assignedTo: "x", createdBy: setBy });
    assert.deepEqual(cardOwners(board, "rnd", []), { assignedTo: null, createdBy: setBy });
    assert.deepEqual(cardOwners(board, "rule", ["x"]), { assignedTo: person, createdBy: ruleSetBy });
  });
});

describe("isInternalCompanyName", () => {
  it("recognises our own company however it is spaced or cased", async () => {
    const { isInternalCompanyName } = await import("../src/utils/ticketTypes.js");
    assert.equal(isInternalCompanyName("Grow Path For Business Development"), true);
    assert.equal(isInternalCompanyName("  grow path  for business development "), true);
    assert.equal(isInternalCompanyName("Grow Path Trading"), false);
    assert.equal(isInternalCompanyName(undefined), false);
  });
});
