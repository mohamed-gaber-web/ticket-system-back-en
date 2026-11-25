/**
 * Resolved Date fallback. A consultant may move a ticket straight to Delivered
 * or Closed without passing through Resolved; the ticket would then have no
 * resolved date. In that case the resolved date takes the delivered date (else
 * the closed date, else now).
 *
 * Call it after the status-change stamps (`deliveredAt` / `closedAt`) are in
 * `updateData`. It only fills an EMPTY resolved date — a ticket that went
 * through Resolved, or a manually entered Resolved Date, keeps its own.
 */
export const RESOLVED_FALLBACK_STATUSES = new Set(["delivered", "closed"]);

export const applyResolvedFallback = ({ status, ticket, updateData, actorId = null, now = new Date() }) => {
  if (!RESOLVED_FALLBACK_STATUSES.has(status)) return updateData;
  if (ticket?.resolvedAt || updateData.resolvedAt) return updateData;
  const date = updateData.deliveredAt || ticket?.deliveredAt || updateData.closedAt || ticket?.closedAt || now;
  updateData.resolvedAt = date;
  if (actorId && !ticket?.resolvedBy && !updateData.resolvedBy) updateData.resolvedBy = actorId;
  return updateData;
};
