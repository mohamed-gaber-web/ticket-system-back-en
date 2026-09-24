/**
 * The signed-in person as a polymorphic reference. Every member of staff is an
 * employee (the `Consultant` model) now; the model name is still stored next to
 * the id (a `refPath`) because rows written before the employee merge may point
 * at the legacy `TeleSalesAgent` collection.
 */
export const actorModel = () => "Consultant";

export const actorName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "";

export const actorRef = (req) => ({
  id: req.user._id,
  type: actorModel(req),
  name: actorName(req.user),
  email: req.user.email,
});
