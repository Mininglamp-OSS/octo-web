import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source-guard test for handleGlobalSearchClick("contacts") self short-circuit.
//
// Why source-guard, not runtime: importing Pages/Chat/vm.ts pulls the whole
// chat stack (WKApp, apiClient, EndpointManager, react-virtuoso) into vitest
// and blows up on transitive ESM. selfInject's helpers are behavior-tested
// directly (selfInject.test.ts); this file locks in the vm.ts edit that
// forwards self clicks to the profile page instead of "notes-to-self" DM.
//
// Regression risk: a well-meaning cleanup could delete the self short-circuit
// thinking "resp.follow==0 will handle it" — but the backend's
// GetCommonSpaceID(self,self) fallback in modules/user/service.go (folds
// follow to 1 for real users in any Space)
// hard-sets follow=1 for real users in any Space, so without this guard
// clicking self opens a "notes-to-self" conversation instead of the profile
// page (RC-1368 v2 report).

const vmPath = path.resolve(
  __dirname,
  "../../../Pages/Chat/vm.ts"
);
const vmSrc = fs.readFileSync(vmPath, "utf8");

describe("handleGlobalSearchClick contacts self short-circuit (source guard)", () => {
  it("§A: contacts branch checks item.channel_id === WKApp.loginInfo.uid before the follow lookup", () => {
    // Must appear BEFORE `WKApp.apiClient.get('users/${item.channel_id}')`
    // (the follow lookup). Extract the contacts Person block and verify order.
    const contactsBranchStart = vmSrc.indexOf(
      'if (type === "contacts")'
    );
    expect(contactsBranchStart).toBeGreaterThan(-1);
    const selfGuardIdx = vmSrc.indexOf(
      "item.channel_id === WKApp.loginInfo.uid",
      contactsBranchStart
    );
    const followLookupIdx = vmSrc.indexOf(
      "WKApp.apiClient.get(`users/${item.channel_id}`)",
      contactsBranchStart
    );
    expect(selfGuardIdx).toBeGreaterThan(contactsBranchStart);
    expect(followLookupIdx).toBeGreaterThan(selfGuardIdx);
  });

  it("§B: self branch routes to showUserInfo (profile page), not showConversation", () => {
    // Grab the self-guard block by scanning from the guard down to its `return`.
    const guardIdx = vmSrc.indexOf(
      "item.channel_id === WKApp.loginInfo.uid"
    );
    expect(guardIdx).toBeGreaterThan(-1);
    const returnIdx = vmSrc.indexOf("return", guardIdx);
    expect(returnIdx).toBeGreaterThan(guardIdx);
    const selfBlock = vmSrc.slice(guardIdx, returnIdx);
    expect(selfBlock).toMatch(/showUserInfo\s*\(\s*item\.channel_id/);
    expect(selfBlock).not.toMatch(/showConversation/);
  });

  it("§C: root-cause comment mentions the backend GetCommonSpaceID fallback", () => {
    // Locks in why the guard exists so future refactorers don't delete it
    // thinking follow==0 handles the case.
    expect(vmSrc).toMatch(/GetCommonSpaceID/);
  });
});
