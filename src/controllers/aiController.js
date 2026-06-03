import Category from "../models/Category.js";
import Department from "../models/Department.js";
import ServiceType from "../models/ServiceType.js";

const AI_MODEL = "poolside/laguna-xs.2:free";

const parseJson = (text) => {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(cleaned);
};

const generate = async (prompt) => {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "http://localhost:5173",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data.choices[0].message.content;
};

export const analyzeTicket = async (req, res) => {
  try {
    const { subject, description } = req.body;
    if (!description || description.length < 10) {
      return res.status(400).json({ success: false, message: "Description is too short to analyze." });
    }

    const [categories, departments, serviceTypes] = await Promise.all([
      Category.find().select("_id name").lean(),
      Department.find({ isActive: true }).select("_id name").lean(),
      ServiceType.find({ isActive: true }).select("_id name").lean(),
    ]);

    const prompt = `Analyze this support ticket and return a JSON object with exactly these keys:
{
  "category": "<one of: ${categories.map((c) => c.name).join(", ")}>",
  "priority": "<low|medium|high|critical>",
  "department": "<one of: ${departments.map((d) => d.name).join(", ")}>",
  "serviceType": "<one of: ${serviceTypes.map((s) => s.name).join(", ")}>",
  "confidence": <0.0-1.0 float>
}

Ticket Subject: ${subject || "(none)"}
Ticket Description: ${description}

Return ONLY the JSON object, no explanation, no markdown.`;

    const text = await generate(prompt);
    const parsed = parseJson(text);

    const categoryMatch = categories.find(
      (c) => c.name.toLowerCase() === (parsed.category || "").toLowerCase()
    );
    const departmentMatch = departments.find(
      (d) => d.name.toLowerCase() === (parsed.department || "").toLowerCase()
    );
    const serviceTypeMatch = serviceTypes.find(
      (s) => s.name.toLowerCase() === (parsed.serviceType || "").toLowerCase()
    );

    res.json({
      success: true,
      data: {
        ...parsed,
        categoryId: categoryMatch?._id?.toString(),
        departmentId: departmentMatch?._id?.toString(),
        serviceTypeId: serviceTypeMatch?._id?.toString(),
      },
    });
  } catch (error) {
    console.error("AI analyzeTicket error:", error?.message || error);
    res.status(422).json({ success: false, message: error?.message || "AI analysis failed. Please try again." });
  }
};

export const suggestDescription = async (req, res) => {
  try {
    const { subject } = req.body;
    if (!subject || subject.trim().length < 3) {
      return res.status(400).json({ success: false, message: "Subject is too short to suggest a description." });
    }

    const prompt = `You are a support agent drafting a support ticket. Based only on the short subject line below, write a clear, professional ticket description that a developer reading it would understand.

Subject: "${subject.trim()}"

Guidelines:
- Expand the subject into 2-4 sentences describing the problem.
- State what the user is experiencing, where/when it happens, and the expected vs. actual behaviour.
- Use neutral, professional language. Do not invent specific names, IDs, or dates.
- Return ONLY the description text — no greeting, no subject line, no quotes, no markdown.`;

    const text = await generate(prompt);
    const suggestedDescription = (text || "")
      .replace(/^```[a-z]*\n?|\n?```$/g, "")
      .replace(/^["']|["']$/g, "")
      .trim();

    if (!suggestedDescription) {
      return res.status(422).json({ success: false, message: "Could not generate a description. Please try again." });
    }

    res.json({ success: true, data: { suggestedDescription } });
  } catch (error) {
    console.error("AI suggestDescription error:", error?.message || error);
    res.status(422).json({ success: false, message: "Could not generate a description. Please try again." });
  }
};

export const draftReply = async (req, res) => {
  try {
    const { ticketSubject, ticketDescription, ticketStatus, previousComments } = req.body;

    const commentsContext = (previousComments || [])
      .map((c) => `[${(c.userType || "user").toUpperCase()}]: ${c.content}`)
      .join("\n");

    const prompt = `You are a professional support consultant responding to a customer support ticket.

Ticket Subject: ${ticketSubject}
Ticket Status: ${ticketStatus}
Ticket Description: ${ticketDescription}

${commentsContext ? `Previous conversation:\n${commentsContext}` : "No previous comments."}

Write a professional, empathetic, and helpful reply to the customer. Be concise (3-5 sentences).
Do not include greetings like "Dear" or sign-offs. Return only the reply text.`;

    const text = await generate(prompt);
    res.json({ success: true, data: { draft: text.trim() } });
  } catch (error) {
    console.error("AI draftReply error:", error);
    res.status(422).json({ success: false, message: "AI draft generation failed. Please try again." });
  }
};

export const getTicketInsights = async (req, res) => {
  try {
    const { ticket } = req.body;
    if (!ticket) {
      return res.status(400).json({ success: false, message: "Ticket data is required." });
    }

    const now = new Date();
    const slaDue = ticket.slaDueDate ? new Date(ticket.slaDueDate) : null;
    const hoursUntilSla = slaDue ? ((slaDue - now) / (1000 * 60 * 60)).toFixed(1) : null;
    const daysSinceCreated = ((now - new Date(ticket.createdAt)) / (1000 * 60 * 60 * 24)).toFixed(1);

    const commentsText = (ticket.comments || [])
      .slice(-20)
      .map((c) => `[${c.userType || "user"}]: ${c.commentText || c.content || ""}`)
      .join("\n");

    const categoryName = typeof ticket.category === "object" ? ticket.category?.name : ticket.category;
    const serviceTypeName = typeof ticket.serviceType === "object" ? ticket.serviceType?.name : ticket.serviceType;

    const prompt = `Analyze this support ticket and return a JSON object with exactly these keys:
{
  "summary": "3-4 sentence summary of the ticket and its current state",
  "slaRisk": { "level": "low|medium|high", "explanation": "one sentence why" },
  "nextAction": { "action": "recommended next action", "rationale": "one sentence why" }
}

Ticket data:
- Subject: ${ticket.subject}
- Status: ${ticket.status}
- Priority: ${ticket.priority}
- Created: ${ticket.createdAt} (${daysSinceCreated} days ago)
- SLA Breached: ${ticket.isSlaBreached}
- Hours until SLA due: ${hoursUntilSla ?? "unknown"}
- Category: ${categoryName || "unknown"}
- Service Type: ${serviceTypeName || "unknown"}
- Description: ${ticket.description}
${commentsText ? `- Comments:\n${commentsText}` : "- No comments yet"}

Return ONLY the JSON object, no explanation, no markdown.`;

    const text = await generate(prompt);
    const data = parseJson(text);
    res.json({ success: true, data });
  } catch (error) {
    console.error("AI getTicketInsights error:", error);
    res.status(422).json({ success: false, message: "Could not generate insights. Please try again." });
  }
};

export const parseSearch = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, message: "Query is required." });
    }

    const today = new Date().toISOString().split("T")[0];

    const prompt = `You are a search query parser for a ticket management system. Today is ${today}.
Convert this natural language query into structured filter parameters.

Valid status values: new, assigned, in_progress, customer_pending, resolved, tested, closed, delivered, not_related
Valid priority values: low, medium, high, critical

Query: "${query}"

Return a JSON object with ONLY the applicable fields (omit fields not relevant to the query):
{
  "status": ["string"] or "string",
  "priority": ["string"] or "string",
  "createdDateFrom": "YYYY-MM-DD",
  "createdDateTo": "YYYY-MM-DD",
  "search": "keyword string",
  "interpretedQuery": "plain English one-sentence summary of what was searched"
}

Return ONLY the JSON object, no explanation, no markdown.`;

    const text = await generate(prompt);
    const data = parseJson(text);
    res.json({ success: true, data });
  } catch (error) {
    console.error("AI parseSearch error:", error);
    res.status(422).json({ success: false, message: "Could not parse your query. Please try again." });
  }
};
