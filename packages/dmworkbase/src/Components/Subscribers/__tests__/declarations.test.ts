import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Runs in the existing unit-test CI gate, independent of the legacy tsc baseline. */
function duplicateClassMembers(text: string) {
  const source = ts.createSourceFile("component.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const duplicates: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const seen = new Map<string, Set<ts.SyntaxKind>>();
      for (const member of node.members) {
        if (!member.name) continue;
        const name = member.name.getText(source);
        const kinds = seen.get(name) ?? new Set<ts.SyntaxKind>();
        const accessorPair = kinds.size === 1 &&
          ((ts.isGetAccessorDeclaration(member) && kinds.has(ts.SyntaxKind.SetAccessor)) ||
           (ts.isSetAccessorDeclaration(member) && kinds.has(ts.SyntaxKind.GetAccessor)));
        if (kinds.size && !accessorPair) duplicates.push(name);
        kinds.add(member.kind);
        seen.set(name, kinds);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return duplicates;
}

describe("subscriber class declaration guard", () => {
  it.each(["list_vm.ts", "memberRemovalList.tsx", "vm.ts"])("%s has no duplicate handlers/properties", (file) => {
    expect(duplicateClassMembers(readFileSync(resolve(__dirname, "..", file), "utf8"))).toEqual([]);
  });
  it("kills the duplicate onSearchChange regression but permits getter/setter pairs", () => {
    expect(duplicateClassMembers("class X { onSearchChange = () => {}; onSearchChange = () => {}; }"))
      .toEqual(["onSearchChange"]);
    expect(duplicateClassMembers("class X { get value() { return 1; } set value(v) {} }"))
      .toEqual([]);
  });
});
