import { BufferJSON, initAuthCreds, proto } from "@whiskeysockets/baileys";
import WhatsAppSession from "../models/WhatsAppSession.js";
import WhatsAppAuthKey from "../models/WhatsAppAuthKey.js";

// Baileys auth state kept in Mongo instead of the folder useMultiFileAuthState
// writes — the Railway disk is wiped on every deploy.
const encode = (value) => JSON.stringify(value, BufferJSON.replacer);
const decode = (text) => JSON.parse(text, BufferJSON.reviver);

export const useMongoAuthState = async (employeeId) => {
  const session = await WhatsAppSession.findOne({ employee: employeeId }).lean();
  // No saved login means a fresh QR link with a brand-new identity: signal keys
  // left over from an earlier link belong to the old identity and would break
  // decryption, so start from an empty key store.
  if (!session?.creds) await WhatsAppAuthKey.deleteMany({ employee: employeeId });
  const creds = session?.creds ? decode(session.creds) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const docs = await WhatsAppAuthKey.find({
            employee: employeeId,
            key: { $in: ids.map((id) => `${type}-${id}`) },
          }).lean();
          const byKey = new Map(docs.map((d) => [d.key, d.value]));
          const data = {};
          for (const id of ids) {
            const raw = byKey.get(`${type}-${id}`);
            let value = raw ? decode(raw) : null;
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const ops = [];
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              const key = `${type}-${id}`;
              ops.push(
                value
                  ? {
                      updateOne: {
                        filter: { employee: employeeId, key },
                        update: { $set: { value: encode(value) } },
                        upsert: true,
                      },
                    }
                  : { deleteOne: { filter: { employee: employeeId, key } } }
              );
            }
          }
          if (ops.length) await WhatsAppAuthKey.bulkWrite(ops, { ordered: false });
        },
      },
    },
    // Must run the query here: Baileys calls saveCreds() without awaiting it,
    // and a Mongoose query that is never awaited is never sent — the login
    // would live only in memory and be lost on the next restart.
    saveCreds: async () => {
      try {
        await WhatsAppSession.updateOne({ employee: employeeId }, { $set: { creds: encode(creds) } }, { upsert: true });
      } catch (err) {
        console.error("[whatsapp] saving the login failed:", err.message);
      }
    },
  };
};

/** Forget a session's login entirely (after logout or when WhatsApp unlinks it). */
export const clearMongoAuthState = async (employeeId) => {
  await WhatsAppAuthKey.deleteMany({ employee: employeeId });
  await WhatsAppSession.updateOne(
    { employee: employeeId },
    { $set: { creds: null, status: "disconnected", phone: null, name: null, connectedAt: null } }
  );
};
