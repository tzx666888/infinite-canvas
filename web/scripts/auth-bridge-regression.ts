import assert from "node:assert/strict";

import { parseTokaxisIdentity } from "../src/lib/auth/tokaxis-identity.ts";

assert.deepEqual(parseTokaxisIdentity({ id: 1, username: "root", display_name: "Root", role: 100 }), {
    id: 1,
    username: "root",
    displayName: "Root",
    role: 100,
});
assert.deepEqual(parseTokaxisIdentity({ id: 2, username: "member", displayName: "Member", role: 1 }), {
    id: 2,
    username: "member",
    displayName: "Member",
    role: 1,
});
assert.deepEqual(parseTokaxisIdentity({ id: 3, username: "credited", display_name: "Credited", role: 1, canvas_credits: 120 }), {
    id: 3,
    username: "credited",
    displayName: "Credited",
    role: 1,
    canvasCredits: 120,
});
assert.equal(parseTokaxisIdentity({ id: 4, username: "invalid", display_name: "Invalid", role: 1, canvas_credits: -1 }), null);
assert.equal(parseTokaxisIdentity({ id: 1, username: "root", role: 100 }), null);

console.log("TokAxis canvas auth bridge regression checks passed.");
