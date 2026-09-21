/**
 * The signed-in person as a polymorphic reference. Tele-sales routes are
 * reached by TeleSalesAgent *and* Consultant accounts, so anything that records
 * "who did this" stores the model name next to the id (a `refPath`).
 */
export const actorModel = (req) => (req.userType === "consultant" ? "Consultant" : "TeleSalesAgent");

export const actorName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "";

export const actorRef = (req) => ({
  id: req.user._id,
  type: actorModel(req),
  name: actorName(req.user),
  email: req.user.email,
});
