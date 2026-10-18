import { addDays, arDate, diffDays } from "./dates.js";
import { isPaid, remaining } from "./calc.js";

/**
 * Grow Path Collect — reminder engine (GROW_PATH_COLLECT_SPEC.md §6), pure.
 * Rules × targets → mails. Per "family" (the same installment / contract /
 * cheque, the same trigger kind, client vs internal) only the LATEST due rule
 * is kept, so an installment 20 days late with rules overdue+3 and overdue+15
 * yields one mail (the +15 one). Mails whose dedupeKey is already in the
 * ReminderLog are dropped. Tests: tests/collect.test.js.
 */

export const TRIGGERS = ["due", "overdue", "renewal", "sign", "cheque"];
export const RECIPIENTS = ["client", "internal", "both"];

export const TRIGGER_LABELS = {
  due: "قبل الاستحقاق",
  overdue: "بعد التأخير",
  renewal: "قبل انتهاء العقد",
  sign: "بعد إرسال العقد",
  cheque: "قبل تاريخ الشيك",
};

const FAMILY = { due: "due", overdue: "overdue", renewal: "ren", sign: "sign", cheque: "cheque" };

export const CURRENCY_LABELS = { EGP: "ج.م", SAR: "ر.س", USD: "$" };

const n0 = (v) => new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0));
export const money = (v, cur) => `${n0(v)} ${CURRENCY_LABELS[cur] ?? cur ?? ""}`.trim();

export const NO_CLIENT_EMAIL = "(بدون بريد للعميل)";
export const NO_INTERNAL_EMAIL = "(البريد الداخلي غير محدد)";

const idOf = (x) => String(x?._id ?? x?.id ?? x ?? "");

/** Replace {{name}} tokens; unknown tokens stay as they are. */
export const fill = (text, vars) =>
  String(text ?? "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, name) =>
    vars[name] == null || vars[name] === "" ? all : String(vars[name])
  );

/**
 * Placeholder values for one mail. `ref` is the day the numbers are counted
 * from: today for the outbox, the trigger date for upcoming mails.
 */
export const placeholderVars = ({ contract, inst, cheque, customer, settings, ref }) => {
  const v = {
    "العميل": customer?.name ?? "",
    "جهة_الاتصال": customer?.contactName ?? "",
    "مدير_الحساب": customer?.collect?.accountManager ?? "",
    "الشركة": settings?.company ?? "",
  };
  if (contract) {
    Object.assign(v, {
      "رقم_العقد": contract.no,
      "العقد": contract.name,
      "قيمة_العقد": money(contract.value, contract.currency),
      "تاريخ_البداية": arDate(contract.startDate),
      "تاريخ_الانتهاء": arDate(contract.endDate),
    });
    if (contract.endDate) v["الأيام_المتبقية"] = diffDays(contract.endDate, ref);
    const sentAt = contract.signature?.sentAt;
    if (sentAt) {
      v["تاريخ_الإرسال"] = arDate(sentAt);
      v["أيام_منذ_الإرسال"] = diffDays(ref, sentAt);
    }
  }
  if (inst) {
    Object.assign(v, {
      "القسط": inst.name,
      "المبلغ": money(inst.amount, contract?.currency),
      "المتبقي": money(remaining(inst), contract?.currency),
      "تاريخ_الاستحقاق": arDate(inst.dueDate),
      "أيام_التأخير": Math.max(0, diffDays(ref, inst.dueDate)),
      "الأيام_المتبقية": Math.max(0, diffDays(inst.dueDate, ref)),
    });
  }
  if (cheque) {
    Object.assign(v, {
      "رقم_الشيك": cheque.number,
      "البنك": cheque.bank ?? "",
      "قيمة_الشيك": money(cheque.amount, cheque.currency),
      "تاريخ_الشيك": arDate(cheque.dueDate),
    });
  }
  return v;
};

/** The targets of one rule with their trigger dates (§6.1). */
export const ruleTargets = (rule, { contracts, typesByKey, cheques }) => {
  const days = Number(rule.days) || 0;
  const typeOk = (c) => !rule.contractTypes?.length || rule.contractTypes.includes(c.typeKey);
  const out = [];
  if (rule.trigger === "due" || rule.trigger === "overdue") {
    for (const c of contracts) {
      if (c.status === "cancelled" || !typeOk(c)) continue;
      for (const inst of c.installments ?? []) {
        if (isPaid(inst)) continue;
        out.push({
          contract: c,
          inst,
          triggerDate: addDays(inst.dueDate, rule.trigger === "due" ? -days : days),
          anchor: inst.dueDate,
          familyId: `inst:${idOf(inst)}`,
          dedupe: idOf(inst),
        });
      }
    }
  } else if (rule.trigger === "renewal") {
    for (const c of contracts) {
      if (c.status !== "active" || !c.endDate || !typeOk(c) || !typesByKey.get(c.typeKey)?.renewable) continue;
      out.push({
        contract: c,
        triggerDate: addDays(c.endDate, -days),
        anchor: c.endDate,
        familyId: `contract:${idOf(c)}`,
        dedupe: `${idOf(c)}|${c.endDate}`,
      });
    }
  } else if (rule.trigger === "sign") {
    for (const c of contracts) {
      const s = c.signature;
      if (c.status === "cancelled" || !typeOk(c) || !["sent", "review"].includes(s?.status) || !s?.sentAt) continue;
      out.push({
        contract: c,
        triggerDate: addDays(s.sentAt, days),
        anchor: s.sentAt,
        familyId: `contract:${idOf(c)}`,
        dedupe: `${idOf(c)}|${s.sentAt}`,
      });
    }
  } else if (rule.trigger === "cheque") {
    const byId = new Map(contracts.map((c) => [idOf(c), c]));
    for (const q of cheques) {
      const c = byId.get(idOf(q.contract));
      if (q.status !== "held" || !q.dueDate || !c || !typeOk(c)) continue;
      out.push({
        contract: c,
        cheque: q,
        triggerDate: addDays(q.dueDate, -days),
        anchor: q.dueDate,
        familyId: `cheque:${idOf(q)}`,
        dedupe: `${idOf(q)}|${q.dueDate}`,
      });
    }
  }
  return out;
};

/** Recipient addresses (and the label shown when one is missing). */
export const recipientsFor = (recipient, customer, settings) => {
  const to = [];
  const labels = [];
  if (recipient === "client" || recipient === "both") {
    const e = customer?.contactEmail;
    if (e) to.push(e);
    labels.push(e || NO_CLIENT_EMAIL);
  }
  if (recipient === "internal" || recipient === "both") {
    const e = settings?.internalEmail;
    if (e) to.push(e);
    labels.push(e || NO_INTERNAL_EMAIL);
  }
  return { to, toText: labels.join("، "), missing: labels.some((l) => l === NO_CLIENT_EMAIL || l === NO_INTERNAL_EMAIL) };
};

/**
 * The outbox (mails due today or earlier, not yet sent) and the mails
 * scheduled within the next 30 days.
 */
export const buildMails = ({ rules, templatesByKey, contracts, typesByKey, cheques, customersById, settings, sentKeys, today }) => {
  const due = new Map(); // family → candidate with the latest trigger date
  const upcoming = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    const tpl = templatesByKey.get(rule.templateKey);
    if (!tpl) continue;
    for (const t of ruleTargets(rule, { contracts, typesByKey, cheques })) {
      const cand = { rule, tpl, ...t };
      if (t.triggerDate > today) {
        if (t.triggerDate <= addDays(today, 30)) upcoming.push(cand);
        continue;
      }
      if (rule.trigger === "due" && today > t.anchor) continue;
      if (rule.trigger === "renewal" && today > t.anchor) continue;
      if (rule.trigger === "cheque" && today > addDays(t.anchor, 30)) continue;
      const family = `${t.familyId}|${FAMILY[rule.trigger]}|${rule.recipient === "internal" ? "int" : "cli"}`;
      const prev = due.get(family);
      if (!prev || t.triggerDate > prev.triggerDate) due.set(family, cand);
    }
  }

  const toMail = (cand, ref) => {
    const { rule, tpl, contract, inst, cheque } = cand;
    const customer = customersById.get(idOf(contract.customer));
    const vars = placeholderVars({ contract, inst, cheque, customer, settings, ref });
    const r = recipientsFor(rule.recipient, customer, settings);
    return {
      dedupeKey: `${rule.key}|${cand.dedupe}`,
      ruleKey: rule.key,
      trigger: rule.trigger,
      days: Number(rule.days) || 0,
      recipient: rule.recipient,
      triggerDate: cand.triggerDate,
      contractId: idOf(contract),
      contractNo: contract.no,
      customerName: customer?.name ?? "",
      installmentId: inst ? idOf(inst) : null,
      chequeId: cheque ? idOf(cheque) : null,
      to: r.to,
      toText: r.toText,
      missingEmail: r.missing,
      subject: fill(tpl.subject, vars),
      body: fill(tpl.body, vars),
    };
  };

  const outbox = [...due.values()]
    .map((c) => toMail(c, today))
    .filter((m) => !sentKeys.has(m.dedupeKey))
    .sort((a, b) => a.triggerDate.localeCompare(b.triggerDate) || a.contractNo.localeCompare(b.contractNo));
  const scheduled = upcoming
    .map((c) => toMail(c, c.triggerDate))
    .filter((m) => !sentKeys.has(m.dedupeKey))
    .sort((a, b) => a.triggerDate.localeCompare(b.triggerDate));
  return { outbox, upcoming: scheduled };
};
